import importlib
from pathlib import Path
from unittest.mock import Mock, patch

from DMAPI.ServerManager import DMLocalServerManager


server_manager_module = importlib.import_module("DMAPI.ServerManager")


def test_reuses_healthy_base_url():
    manager = DMLocalServerManager(base_url="http://127.0.0.1:9000")
    with patch.object(manager, "_is_healthy", return_value=True), patch.object(
        manager, "_start"
    ) as start:
        assert manager.ensure_running() == "http://127.0.0.1:9000"
        start.assert_not_called()


def test_skips_occupied_port_and_starts_next_available(tmp_path):
    exe = tmp_path / "dmlocalapi_server.exe"
    exe.write_bytes(b"fake")
    manager = DMLocalServerManager(exe_path=str(exe), default_port=8765)

    with patch.object(manager, "_is_healthy", return_value=False), patch.object(
        manager, "_is_port_available", side_effect=[False, True]
    ), patch.object(manager, "_start") as start, patch.object(
        manager, "_wait_until_healthy"
    ) as wait:
        assert manager.ensure_running() == "http://127.0.0.1:8766"
        start.assert_called_once_with(Path(exe), 8766)
        wait.assert_called_once_with("http://127.0.0.1:8766")


def test_close_only_stops_process_started_by_client():
    manager = DMLocalServerManager()
    process = Mock()
    process.poll.return_value = None
    manager.process = process
    manager.started_by_client = True

    manager.close()

    process.terminate.assert_called_once()
    process.wait.assert_called_once_with(timeout=3)


def test_resolve_exe_path_supports_src_dist_layout(tmp_path, monkeypatch):
    repo_root = tmp_path / "AutoDaoMengPublic"
    package_dir = repo_root / "src" / "DMAPI"
    package_dir.mkdir(parents=True)
    fake_module_file = package_dir / "ServerManager.py"
    fake_module_file.write_text("# fake", encoding="utf-8")

    bundled_exe = repo_root / "src" / "dist" / "dmlocalapi_server.exe"
    bundled_exe.parent.mkdir(parents=True)
    bundled_exe.write_bytes(b"fake")

    monkeypatch.setattr(server_manager_module, "__file__", str(fake_module_file))
    monkeypatch.setattr(server_manager_module.sys, "argv", [str(repo_root / "src" / "main.py")])

    with patch.dict(server_manager_module.os.environ, {}, clear=True):
        manager = DMLocalServerManager()
        assert manager._resolve_exe_path() == bundled_exe
