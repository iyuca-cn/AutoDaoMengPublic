import json
from io import StringIO

import pytest

from dmapi_cli import main as cli_main


class StubDMAPI:
    def __init__(self):
        self.calls = []

    def get_mime_manage_activity_dict(self):
        self.calls.append(("get_mime_manage_activity_dict",))
        return {
            "1001": {"name": "活动一", "status": "open"},
            "1002": {"title": "活动二"},
        }

    def get_signid(self, activity_id):
        self.calls.append(("get_signid", activity_id))
        return "sign-001"

    def get_sign_list(self, activity_id, sign_type):
        self.calls.append(("get_sign_list", activity_id, sign_type))
        return [{"signUpId": "su-1", "userId": "u-1", "name": "张三"}]

    def get_creditType_list(self, activity_id):
        self.calls.append(("get_creditType_list", activity_id))
        return [{"scoreId": "s-1", "scorename": "美育实践学分", "unitcount": "1.00"}]

    def get_credit_list(self, url, activity_id, score_id):
        self.calls.append(("get_credit_list", url, activity_id, score_id))
        return [{"userId": "u-1", "name": "张三"}]

    def export_mem_excel(self, activity_id, export_type):
        self.calls.append(("export_mem_excel", activity_id, export_type))
        return b"xlsx"

    def resign(self, activity_id, signup_ids, is_all):
        self.calls.append(("resign", activity_id, signup_ids, is_all))
        return True

    def send_credit(self, activity_id, score_id, user_list):
        self.calls.append(("send_credit", activity_id, score_id, user_list))
        return True

    def send_creditBy_signUpId(self, activity_id, score_id, signup_ids):
        self.calls.append(("send_creditBy_signUpId", activity_id, score_id, signup_ids))
        return (True, [])

    def get_uid_and_token_from_export_url(self, url):
        self.calls.append(("get_uid_and_token_from_export_url", url))
        return "uid-1", "secret-token"


def _run(argv, stub=None, input_text=""):
    stub = stub or StubDMAPI()
    output = StringIO()
    error = StringIO()
    created = []

    def factory(config_path):
        created.append(config_path)
        return stub

    exit_code = cli_main.main(
        argv,
        dmapi_factory=factory,
        input_func=lambda _prompt="": input_text,
        output_stream=output,
        error_stream=error,
    )
    return exit_code, output.getvalue(), error.getvalue(), stub, created


def test_activities_command_uses_config_and_prints_records():
    exit_code, output, error, stub, created = _run(
        ["--config", "custom.ini", "activities"]
    )

    assert exit_code == 0
    assert error == ""
    assert created == ["custom.ini"]
    assert ("get_mime_manage_activity_dict",) in stub.calls
    assert "共 2 个可管理活动" in output
    assert "activityId=1001" in output


def test_sign_id_supports_json_after_subcommand():
    exit_code, output, _, stub, _ = _run(
        ["sign-id", "--activity-id", "1001", "--json"]
    )

    assert exit_code == 0
    payload = json.loads(output)
    assert payload["success"] is True
    assert payload["data"]["sign_id"] == "sign-001"
    assert stub.calls == [("get_signid", "1001")]


def test_sign_list_maps_type_choice_to_dmapi_constant():
    exit_code, _, _, stub, _ = _run(
        ["sign-list", "--activity-id", "1001", "--type", "signed"]
    )

    assert exit_code == 0
    assert stub.calls == [("get_sign_list", "1001", cli_main.DMAPI.SIGN_TYPE_SIGNED)]


def test_credit_list_maps_kind_to_dmapi_url():
    exit_code, _, _, stub, _ = _run(
        [
            "credit-list",
            "--activity-id",
            "1001",
            "--score-id",
            "score-1",
            "--kind",
            "credited",
        ]
    )

    assert exit_code == 0
    assert stub.calls == [
        (
            "get_credit_list",
            cli_main.DMAPI.CREDIT_URL_CREDITEDMEM,
            "1001",
            "score-1",
        )
    ]


def test_export_members_writes_file(tmp_path):
    output_path = tmp_path / "admit.xlsx"

    exit_code, output, _, stub, _ = _run(
        [
            "export-members",
            "--activity-id",
            "1001",
            "--type",
            "admit",
            "--output",
            str(output_path),
        ]
    )

    assert exit_code == 0
    assert output_path.read_bytes() == b"xlsx"
    assert "导出成功" in output
    assert stub.calls == [
        ("export_mem_excel", "1001", cli_main.DMAPI.EXPORT_TYPE_ADMIT)
    ]


def test_mutating_command_cancel_does_not_create_dmapi():
    output = StringIO()
    error = StringIO()

    def factory(_config_path):
        raise AssertionError("DMAPI should not be initialized when cancelled")

    exit_code = cli_main.main(
        [
            "send-credit",
            "--activity-id",
            "1001",
            "--score-id",
            "score-1",
            "--user-id",
            "u-1",
        ],
        dmapi_factory=factory,
        input_func=lambda _prompt="": "no",
        output_stream=output,
        error_stream=error,
    )

    assert exit_code == 1
    assert "已取消执行" in output.getvalue()
    assert error.getvalue() == ""


def test_send_credit_yes_maps_user_ids():
    exit_code, _, _, stub, _ = _run(
        [
            "send-credit",
            "--activity-id",
            "1001",
            "--score-id",
            "score-1",
            "--user-id",
            "u-1",
            "u-2",
            "--yes",
        ]
    )

    assert exit_code == 0
    assert stub.calls == [("send_credit", "1001", "score-1", "u-1,u-2")]


def test_resign_exact_confirmation_maps_signup_ids():
    exit_code, output, _, stub, _ = _run(
        [
            "resign",
            "--activity-id",
            "1001",
            "--signup-id",
            "su-1",
            "su-2",
        ],
        input_text="EXECUTE resign 1001 2",
    )

    assert exit_code == 0
    assert "这是写操作" in output
    assert stub.calls == [("resign", "1001", ["su-1", "su-2"], False)]


def test_send_credit_signup_yes_maps_signup_ids():
    exit_code, _, _, stub, _ = _run(
        [
            "send-credit-signup",
            "--activity-id",
            "1001",
            "--score-id",
            "score-1",
            "--signup-id",
            "su-1",
            "--yes",
        ]
    )

    assert exit_code == 0
    assert stub.calls == [("send_creditBy_signUpId", "1001", "score-1", ["su-1"])]


def test_import_export_url_does_not_print_raw_token():
    exit_code, output, _, stub, _ = _run(
        [
            "import-export-url",
            "--url",
            "https://apph5.5idream.net/apih5/api/activity/join/export?activityid=1&api_token=x",
            "--json",
        ]
    )

    assert exit_code == 0
    payload = json.loads(output)
    assert payload["data"] == {"uid": "uid-1", "token_saved": True}
    assert "secret-token" not in output
    assert stub.calls == [
        (
            "get_uid_and_token_from_export_url",
            "https://apph5.5idream.net/apih5/api/activity/join/export?activityid=1&api_token=x",
        )
    ]


def test_failed_dmapi_result_returns_nonzero():
    class FailedDMAPI(StubDMAPI):
        def get_signid(self, activity_id):
            return None

    exit_code, _, error, _, _ = _run(
        ["sign-id", "--activity-id", "missing"],
        stub=FailedDMAPI(),
    )

    assert exit_code == 1
    assert "无法读取签到卡 ID" in error


def test_value_error_returns_usage_error_code():
    class FailedDMAPI(StubDMAPI):
        def get_uid_and_token_from_export_url(self, url):
            raise ValueError("URL格式不正确")

    exit_code, _, error, _, _ = _run(
        ["import-export-url", "--url", "bad"],
        stub=FailedDMAPI(),
    )

    assert exit_code == 2
    assert "URL格式不正确" in error


def test_parser_rejects_resign_without_target():
    parser = cli_main.build_parser()

    with pytest.raises(SystemExit):
        parser.parse_args(["resign", "--activity-id", "1001"])
