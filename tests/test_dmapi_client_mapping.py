import configparser
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from DMAPI import DMAPI


class FakeResponse:
    def __init__(self, status_code=200, payload=None, content=b"", headers=None):
        self.status_code = status_code
        self._payload = payload or {"success": True, "data": None}
        self.content = content
        self.headers = headers or {"content-type": "application/json"}

    def json(self):
        return self._payload


def _config_path(login: dict[str, str] | None = None):
    temp_dir = tempfile.TemporaryDirectory()
    config_path = Path(temp_dir.name) / "config.ini"
    if login:
        config = configparser.ConfigParser()
        config["login"] = login
        with open(config_path, "w", encoding="utf-8") as file:
            config.write(file)
    return temp_dir, str(config_path)


def test_get_activity_list_maps_to_local_route():
    temp_dir, config_path = _config_path({"uid": "u1", "token": "t1"})
    with temp_dir:
        with patch.dict({"DMLOCALAPI_DISABLE_AUTOSTART": "1"}), patch(
            "requests.request"
        ) as request:
            request.return_value = FakeResponse(payload={"success": True, "data": True})
            api = DMAPI(config_path)
            assert api.get_activityList("508956") is True
            _, kwargs = request.call_args
            assert kwargs["params"] == {"tribeId": "508956"}


def test_send_credit_passes_operation_to_local_client():
    temp_dir, config_path = _config_path({"uid": "u1", "token": "t1"})
    with temp_dir:
        with patch.dict({"DMLOCALAPI_DISABLE_AUTOSTART": "1"}), patch(
            "DMAPI.DMAPI.DMLocalClient.post", return_value=True
        ) as post_request, patch(
            "DMAPI.DMAPI.DMLocalClient.get", return_value=True
        ):
            api = DMAPI(config_path)
            assert api.send_credit("1", "2", "u-001") is True

    _, kwargs = post_request.call_args
    assert kwargs["operation"] == "send_credit"


def test_send_credit_rejects_empty_user_list():
    temp_dir, config_path = _config_path({"uid": "u1", "token": "t1"})
    with temp_dir:
        with patch.dict({"DMLOCALAPI_DISABLE_AUTOSTART": "1"}), patch(
            "requests.request"
        ) as request:
            request.return_value = FakeResponse(payload={"success": True, "data": True})
            api = DMAPI(config_path)
        with pytest.raises(ValueError):
            api.send_credit("1", "2", "")


def test_send_credit_by_signup_id_converts_list_to_tuple():
    temp_dir, config_path = _config_path({"uid": "u1", "token": "t1"})
    with temp_dir:
        with patch.dict({"DMLOCALAPI_DISABLE_AUTOSTART": "1"}), patch(
            "requests.request"
        ) as request:
            request.return_value = FakeResponse(
                payload={"success": True, "data": [True, ["10"]]}
            )
            api = DMAPI(config_path)
            assert api.send_creditBy_signUpId("1", "2", ["10"]) == (True, ["10"])


def test_export_returns_bytes():
    temp_dir, config_path = _config_path({"uid": "u1", "token": "t1"})
    with temp_dir:
        with patch.dict({"DMLOCALAPI_DISABLE_AUTOSTART": "1"}), patch(
            "requests.request"
        ) as request, patch("requests.get") as get_request:
            request.return_value = FakeResponse(payload={"success": True, "data": True})
            get_request.return_value = FakeResponse(
                payload={},
                content=b"xlsx",
                headers={"content-type": "application/octet-stream"},
            )
            api = DMAPI(config_path)
            assert api.export_mem_excel("1", DMAPI.EXPORT_TYPE_ADMIT) == b"xlsx"


def test_init_prompts_for_account_login_when_no_saved_session(monkeypatch):
    temp_dir, config_path = _config_path()
    with temp_dir:
        inputs = iter(["n", "13800000000", "secret"])
        monkeypatch.setattr("builtins.input", lambda _prompt="": next(inputs))

        with patch.dict({"DMLOCALAPI_DISABLE_AUTOSTART": "1"}), patch(
            "requests.request"
        ) as request:
            request.return_value = FakeResponse(
                payload={
                    "success": True,
                    "data": {"uid": "user-1", "token": "token-1"},
                }
            )
            api = DMAPI(config_path)

        config = configparser.ConfigParser()
        config.read(config_path, encoding="utf-8")
        assert api.uid == "user-1"
        assert api.token == "token-1"
        assert config.get("login", "account") == "13800000000"
        assert config.get("login", "pwd") == "secret"
        assert config.get("login", "uid") == "user-1"
        assert config.get("login", "token") == "token-1"
