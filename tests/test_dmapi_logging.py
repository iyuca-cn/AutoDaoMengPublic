from unittest.mock import patch

import pytest

from DMAPI.DMLocalClient import DMLocalClient, LocalApiError


class FakeResponse:
    def __init__(self, status_code=200, payload=None, content=b"", headers=None):
        self.status_code = status_code
        self._payload = payload or {"success": True, "data": None}
        self.content = content
        self.headers = headers or {"content-type": "application/json"}

    def json(self):
        return self._payload


def test_json_request_logs_masked_request_and_response_summary():
    with patch("DMAPI.DMLocalClient.requests.request") as request, patch(
        "DMAPI.DMLocalClient.logger"
    ) as fake_logger:
        request.return_value = FakeResponse(
            payload={
                "success": True,
                "data": {"uid": "user-1", "token": "token-1"},
            }
        )
        client = DMLocalClient(base_url="http://127.0.0.1:8765")

        result = client.post(
            "/session/login",
            {"account": "13800000000", "pwd": "secret"},
            operation="login",
        )

    assert result == {"uid": "user-1", "token": "token-1"}
    debug_message = fake_logger.debug.call_args[0][0]
    info_message = fake_logger.info.call_args[0][0]
    assert '"operation": "login"' in debug_message
    assert "13800000000" not in debug_message
    assert "secret" not in debug_message
    assert "user-1" not in info_message
    assert "token-1" not in info_message
    assert '"response_summary"' in info_message


def test_json_request_logs_masked_failure_details():
    with patch("DMAPI.DMLocalClient.requests.request") as request, patch(
        "DMAPI.DMLocalClient.logger"
    ) as fake_logger:
        request.return_value = FakeResponse(
            status_code=401,
            payload={
                "success": False,
                "error": {
                    "message": "bad token",
                    "code": "UNAUTHORIZED",
                    "token": "secret-token",
                },
            },
        )
        client = DMLocalClient(base_url="http://127.0.0.1:8765")

        with pytest.raises(LocalApiError):
            client.post(
                "/session",
                {"uid": "user-1", "token": "token-1"},
                operation="restore_session",
            )

    warning_message = fake_logger.warning.call_args[0][0]
    assert '"operation": "restore_session"' in warning_message
    assert "secret-token" not in warning_message
    assert '"error_code": "UNAUTHORIZED"' in warning_message


def test_import_export_url_logs_query_keys_without_api_token():
    with patch("DMAPI.DMLocalClient.requests.request") as request, patch(
        "DMAPI.DMLocalClient.logger"
    ) as fake_logger:
        request.return_value = FakeResponse(
            payload={
                "success": True,
                "data": {"uid": "user-1", "token": "token-1"},
            }
        )
        client = DMLocalClient(base_url="http://127.0.0.1:8765")

        client.post(
            "/session/import-export-url",
            {
                "url": "https://apph5.5idream.net/apih5/api/activity/join/export"
                "?activityid=1&api_token=secret-token"
            },
            operation="import_export_url",
        )

    debug_message = fake_logger.debug.call_args[0][0]
    assert "secret-token" not in debug_message
    assert '"query_keys": ["activityid", "api_token"]' in debug_message
