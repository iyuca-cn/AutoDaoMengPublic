import configparser
import json
import os
from time import perf_counter
from typing import Any
from urllib.parse import parse_qsl, urljoin, urlparse

import requests
from log.log import logger


_SENSITIVE_KEYS = frozenset({"uid", "token", "api_token", "pwd", "account"})
_LIST_SUMMARY_KEYS = frozenset(
    {"userList", "usernameList", "signUpIdList", "signUpId_list"}
)
_URL_KEYS = frozenset({"url"})
_MAX_SAMPLE_ITEMS = 3
_MAX_TEXT_PREVIEW_LENGTH = 80


def _mask_secret(value: Any) -> str:
    text = str(value)
    if not text:
        return ""
    if len(text) <= 2:
        return "*" * len(text)
    if len(text) <= 6:
        return f"{text[0]}***{text[-1]}"
    return f"{text[:3]}***{text[-3:]}"


def _truncate_text(value: Any) -> str:
    text = str(value)
    if len(text) <= _MAX_TEXT_PREVIEW_LENGTH:
        return text
    return f"{text[:_MAX_TEXT_PREVIEW_LENGTH]}...(len={len(text)})"


def _split_items(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    if isinstance(value, (list, tuple, set)):
        return [str(item) for item in value]
    return [str(value)]


def _summarize_collection(value: Any) -> dict[str, Any]:
    items = _split_items(value)
    return {
        "count": len(items),
        "sample": [_mask_secret(item) for item in items[:_MAX_SAMPLE_ITEMS]],
    }


def _summarize_url(value: Any) -> dict[str, Any]:
    text = str(value)
    parsed = urlparse(text)
    return {
        "host": parsed.netloc,
        "path": parsed.path,
        "query_keys": sorted(
            {key for key, _ in parse_qsl(parsed.query, keep_blank_values=True)}
        ),
    }


def _summarize_payload_value(key: str | None, value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, dict):
        return {
            str(child_key): _summarize_payload_value(str(child_key), child_value)
            for child_key, child_value in value.items()
        }
    if key in _LIST_SUMMARY_KEYS:
        return _summarize_collection(value)
    if isinstance(value, (list, tuple, set)):
        values = list(value)
        return {
            "count": len(values),
            "sample": [
                _summarize_payload_value(None, item)
                for item in values[:_MAX_SAMPLE_ITEMS]
            ],
        }
    if isinstance(value, bytes):
        return {"type": "bytes", "length": len(value)}

    text = str(value)
    if key in _URL_KEYS:
        return _summarize_url(text)
    if key in _SENSITIVE_KEYS:
        return _mask_secret(text)
    return _truncate_text(text)


def _summarize_mapping(mapping: dict | None) -> dict[str, Any] | None:
    if mapping is None:
        return None
    return {
        str(key): _summarize_payload_value(str(key), value)
        for key, value in mapping.items()
    }


def _summarize_response(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, dict):
        return {
            "type": "dict",
            "size": len(value),
            "keys": [str(key) for key in value.keys()],
        }
    if isinstance(value, list):
        return {
            "type": "list",
            "size": len(value),
            "item_types": [type(item).__name__ for item in value[:_MAX_SAMPLE_ITEMS]],
        }
    if isinstance(value, bytes):
        return {"type": "bytes", "length": len(value)}
    if isinstance(value, str):
        return {"type": "str", "length": len(value), "preview": _truncate_text(value)}
    return {"type": type(value).__name__}


def _elapsed_ms(started_at: float) -> float:
    return round((perf_counter() - started_at) * 1000, 2)


def _emit_log(level: str, title: str, payload: dict[str, Any]) -> None:
    log_method = getattr(logger, level)
    log_method(f"{title} {json.dumps(payload, ensure_ascii=False, sort_keys=True)}")


class LocalApiError(RuntimeError):
    def __init__(self, message, code="", status_code=None, details=None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.details = details


class DMLocalClient:
    def __init__(
        self,
        base_url: str | None = None,
        config_path: str | None = None,
        timeout: int = 60,
    ):
        self.base_url = (
            base_url
            or os.environ.get("DMLOCALAPI_BASE_URL")
            or self._read_base_url(config_path)
            or "http://127.0.0.1:8765"
        ).rstrip("/")
        self.timeout = timeout

    def get(
        self,
        path: str,
        params: dict | None = None,
        operation: str | None = None,
    ):
        return self._json_request("GET", path, params=params, operation=operation)

    def post(
        self,
        path: str,
        json_obj: dict | None = None,
        operation: str | None = None,
    ):
        return self._json_request(
            "POST",
            path,
            json_obj=json_obj or {},
            operation=operation,
        )

    def get_bytes(
        self,
        path: str,
        params: dict | None = None,
        operation: str | None = None,
    ):
        url = self._url(path)
        started_at = perf_counter()
        request_context = {
            "operation": operation or path,
            "method": "GET",
            "path": path,
            "url": url,
            "params": _summarize_mapping(params),
        }
        _emit_log("debug", "DMapi请求开始", request_context)

        try:
            response = requests.get(
                url,
                params=params,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            _emit_log(
                "warning",
                "DMapi请求失败",
                {
                    **request_context,
                    "elapsed_ms": _elapsed_ms(started_at),
                    "error_message": str(exc),
                    "error_type": type(exc).__name__,
                },
            )
            raise LocalApiError(str(exc)) from exc

        content_type = response.headers.get("content-type", "")
        if response.status_code >= 400 or "application/json" in content_type:
            try:
                payload = response.json()
            except Exception:
                payload = {}
            error = payload.get("error", {}) if isinstance(payload, dict) else {}
            _emit_log(
                "warning",
                "DMapi请求失败",
                {
                    **request_context,
                    "elapsed_ms": _elapsed_ms(started_at),
                    "status_code": response.status_code,
                    "content_type": content_type,
                    "error_code": error.get("code", ""),
                    "error_message": error.get(
                        "message", f"HTTP {response.status_code}"
                    ),
                    "error_details": _summarize_payload_value(None, error),
                },
            )
            raise LocalApiError(
                error.get("message", f"HTTP {response.status_code}"),
                code=error.get("code", ""),
                status_code=response.status_code,
                details=error,
            )

        _emit_log(
            "info",
            "DMapi请求成功",
            {
                **request_context,
                "elapsed_ms": _elapsed_ms(started_at),
                "status_code": response.status_code,
                "response_summary": {
                    "type": "bytes",
                    "length": len(response.content),
                    "content_type": content_type,
                },
            },
        )
        return response.content

    def _json_request(
        self,
        method: str,
        path: str,
        params: dict | None = None,
        json_obj: dict | None = None,
        operation: str | None = None,
    ):
        url = self._url(path)
        started_at = perf_counter()
        request_context = {
            "operation": operation or path,
            "method": method,
            "path": path,
            "url": url,
            "params": _summarize_mapping(params),
            "json": _summarize_mapping(json_obj),
        }
        _emit_log("debug", "DMapi请求开始", request_context)

        try:
            response = requests.request(
                method,
                url,
                params=params,
                json=json_obj,
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            _emit_log(
                "warning",
                "DMapi请求失败",
                {
                    **request_context,
                    "elapsed_ms": _elapsed_ms(started_at),
                    "error_message": str(exc),
                    "error_type": type(exc).__name__,
                },
            )
            raise LocalApiError(str(exc)) from exc

        try:
            payload = response.json()
        except Exception as exc:
            _emit_log(
                "warning",
                "DMapi请求失败",
                {
                    **request_context,
                    "elapsed_ms": _elapsed_ms(started_at),
                    "status_code": response.status_code,
                    "content_type": response.headers.get("content-type", ""),
                    "error_message": (
                        "Local API returned non-JSON response: "
                        f"HTTP {response.status_code}"
                    ),
                    "error_type": type(exc).__name__,
                },
            )
            raise LocalApiError(
                f"Local API returned non-JSON response: HTTP {response.status_code}",
                status_code=response.status_code,
            ) from exc

        if response.status_code >= 400 or not payload.get("success", False):
            error = payload.get("error", {}) if isinstance(payload, dict) else {}
            _emit_log(
                "warning",
                "DMapi请求失败",
                {
                    **request_context,
                    "elapsed_ms": _elapsed_ms(started_at),
                    "status_code": response.status_code,
                    "error_code": error.get("code", ""),
                    "error_message": error.get(
                        "message", f"HTTP {response.status_code}"
                    ),
                    "error_details": _summarize_payload_value(None, error),
                },
            )
            raise LocalApiError(
                error.get("message", f"HTTP {response.status_code}"),
                code=error.get("code", ""),
                status_code=response.status_code,
                details=error,
            )

        data = payload.get("data")
        _emit_log(
            "info",
            "DMapi请求成功",
            {
                **request_context,
                "elapsed_ms": _elapsed_ms(started_at),
                "status_code": response.status_code,
                "response_summary": _summarize_response(data),
            },
        )
        return data

    def _url(self, path: str) -> str:
        return urljoin(self.base_url + "/", path.lstrip("/"))

    def _read_base_url(self, config_path: str | None):
        if not config_path or not os.path.isfile(config_path):
            return None
        config = configparser.ConfigParser()
        config.read(config_path, encoding="utf-8")
        if config.has_section("local_server"):
            return config.get("local_server", "base_url", fallback=None)
        return None
