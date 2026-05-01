import atexit
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

from .DMLocalClient import LocalApiError


class DMLocalServerManager:
    def __init__(
        self,
        base_url: str | None = None,
        exe_path: str | None = None,
        default_port: int = 8765,
        startup_timeout: float = 10.0,
    ):
        self.default_port = default_port
        self.startup_timeout = startup_timeout
        self.process: subprocess.Popen | None = None
        self.started_by_client = False
        self.base_url = (base_url or "").rstrip("/")
        self.exe_path = exe_path

    def ensure_running(self) -> str:
        if self.base_url and self._is_healthy(self.base_url):
            return self.base_url

        preferred_port = self._port_from_base_url(self.base_url) or self.default_port
        preferred_url = self._url_for_port(preferred_port)
        if self._is_healthy(preferred_url):
            self.base_url = preferred_url
            return self.base_url

        exe_path = self._resolve_exe_path()
        for port in self._candidate_ports(preferred_port):
            url = self._url_for_port(port)
            if self._is_healthy(url):
                self.base_url = url
                return self.base_url
            if not self._is_port_available(port):
                continue
            self._start(exe_path, port)
            self.base_url = url
            self._wait_until_healthy(url)
            return self.base_url

        raise LocalApiError("没有可用端口启动 dmlocalapi_server.exe")

    def close(self):
        if not self.started_by_client or self.process is None:
            return
        if self.process.poll() is not None:
            return
        self.process.terminate()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=3)

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

    def _start(self, exe_path: Path, port: int):
        creationflags = 0
        startupinfo = None
        if os.name == "nt":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW

        self.process = subprocess.Popen(
            [str(exe_path), "--port", str(port)],
            cwd=str(exe_path.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            startupinfo=startupinfo,
        )
        self.started_by_client = True
        atexit.register(self.close)

    def _wait_until_healthy(self, url: str):
        deadline = time.monotonic() + self.startup_timeout
        while time.monotonic() < deadline:
            if self.process is not None and self.process.poll() is not None:
                raise LocalApiError("dmlocalapi_server.exe 启动后立即退出")
            if self._is_healthy(url):
                return
            time.sleep(0.2)
        raise LocalApiError(f"dmlocalapi_server.exe 启动超时: {url}")

    def _resolve_exe_path(self) -> Path:
        candidates = []
        if self.exe_path:
            candidates.append(Path(self.exe_path))

        env_path = os.environ.get("DMLOCALAPI_SERVER_EXE")
        if env_path:
            candidates.append(Path(env_path))

        exe_name = "dmlocalapi_server.exe"
        main_dir = (
            Path(sys.argv[0]).resolve().parent if sys.argv and sys.argv[0] else Path.cwd()
        )
        package_dir = Path(__file__).resolve().parent
        candidates.extend(
            [
                main_dir / exe_name,
                Path.cwd() / exe_name,
                package_dir / exe_name,
                package_dir.parent / "dist" / exe_name,
            ]
        )

        for candidate in candidates:
            if candidate.is_file():
                return candidate

        searched = "\n".join(str(path) for path in candidates)
        raise LocalApiError(
            "找不到 dmlocalapi_server.exe，请把它放到 main.py 同目录、dist 目录，"
            "或设置 DMLOCALAPI_SERVER_EXE。\n已搜索:\n" + searched
        )

    def _candidate_ports(self, preferred_port: int):
        yielded = set()
        for port in [
            preferred_port,
            self.default_port,
            *range(self.default_port + 1, self.default_port + 101),
        ]:
            if port in yielded:
                continue
            yielded.add(port)
            yield port

    def _is_healthy(self, base_url: str) -> bool:
        try:
            response = requests.get(f"{base_url.rstrip('/')}/health", timeout=0.5)
            data = response.json()
        except Exception:
            return False
        return response.status_code == 200 and data.get("success") is True

    def _is_port_available(self, port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                return False
            return True

    def _url_for_port(self, port: int) -> str:
        return f"http://127.0.0.1:{port}"

    def _port_from_base_url(self, base_url: str) -> int | None:
        if not base_url:
            return None
        try:
            parsed = urlparse(base_url)
            return parsed.port
        except ValueError:
            return None
