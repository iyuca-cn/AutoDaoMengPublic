from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Callable, TextIO

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from dmapi_cli.output import print_result
else:
    from .output import print_result

from DMAPI.DMAPI import DMAPI


DEFAULT_CONFIG_PATH = "config.ini"

SIGN_TYPE_CHOICES = {
    "unsigned": DMAPI.SIGN_TYPE_UNSIGNED,
    "signed": DMAPI.SIGN_TYPE_SIGNED,
    "signout": DMAPI.SIGN_TYPE_SIGNOUT,
    "leave": DMAPI.SIGN_TYPE_LEAVE,
}

CREDIT_LIST_KIND_CHOICES = {
    "candidates": DMAPI.CREDIT_URL_CANDIDATES,
    "other": DMAPI.CREDIT_URL_OTHERMEMS,
    "credited": DMAPI.CREDIT_URL_CREDITEDMEM,
}

EXPORT_TYPE_CHOICES = {
    "register": DMAPI.EXPORT_TYPE_REGISTER,
    "admit": DMAPI.EXPORT_TYPE_ADMIT,
    "leave": DMAPI.EXPORT_TYPE_LEAVE,
}

MUTATING_COMMANDS = {"resign", "send-credit", "send-credit-signup"}


def _add_json_option(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--json",
        action="store_true",
        dest="as_json",
        default=argparse.SUPPRESS,
        help="以 JSON 格式输出结果",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="直接调用 DMAPI 的命令行工具")
    parser.add_argument("--config", default=DEFAULT_CONFIG_PATH, help="配置文件路径")
    parser.add_argument("--json", action="store_true", dest="as_json", help="以 JSON 格式输出结果")
    subparsers = parser.add_subparsers(dest="command", required=True)

    activities = subparsers.add_parser("activities", help="查看可管理活动")
    _add_json_option(activities)

    sign_id = subparsers.add_parser("sign-id", help="查看活动签到卡 ID")
    sign_id.add_argument("--activity-id", required=True, help="活动 ID")
    _add_json_option(sign_id)

    sign_list = subparsers.add_parser("sign-list", help="查看签到名单")
    sign_list.add_argument("--activity-id", required=True, help="活动 ID")
    sign_list.add_argument("--type", required=True, choices=SIGN_TYPE_CHOICES.keys(), help="签到名单类型")
    _add_json_option(sign_list)

    credit_types = subparsers.add_parser("credit-types", help="查看活动学分项")
    credit_types.add_argument("--activity-id", required=True, help="活动 ID")
    _add_json_option(credit_types)

    credit_list = subparsers.add_parser("credit-list", help="查看学分相关名单")
    credit_list.add_argument("--activity-id", required=True, help="活动 ID")
    credit_list.add_argument("--score-id", required=True, help="学分项 scoreId")
    credit_list.add_argument("--kind", required=True, choices=CREDIT_LIST_KIND_CHOICES.keys(), help="名单类型")
    _add_json_option(credit_list)

    export_members = subparsers.add_parser("export-members", help="导出成员 Excel")
    export_members.add_argument("--activity-id", required=True, help="活动 ID")
    export_members.add_argument("--type", required=True, choices=EXPORT_TYPE_CHOICES.keys(), help="导出名单类型")
    export_members.add_argument("--output", required=True, help="输出 xlsx 文件路径")
    _add_json_option(export_members)

    resign = subparsers.add_parser("resign", help="补签")
    resign.add_argument("--activity-id", required=True, help="活动 ID")
    resign_target = resign.add_mutually_exclusive_group(required=True)
    resign_target.add_argument("--signup-id", nargs="+", help="报名记录 signUpId，可传多个")
    resign_target.add_argument("--all", action="store_true", help="全员补签")
    resign.add_argument("--yes", action="store_true", help="跳过确认")
    _add_json_option(resign)

    send_credit = subparsers.add_parser("send-credit", help="按 userId 发放学分")
    send_credit.add_argument("--activity-id", required=True, help="活动 ID")
    send_credit.add_argument("--score-id", required=True, help="学分项 scoreId")
    send_credit.add_argument("--user-id", nargs="+", required=True, help="用户 userId，可传多个")
    send_credit.add_argument("--yes", action="store_true", help="跳过确认")
    _add_json_option(send_credit)

    send_credit_signup = subparsers.add_parser("send-credit-signup", help="按 signUpId 发放学分")
    send_credit_signup.add_argument("--activity-id", required=True, help="活动 ID")
    send_credit_signup.add_argument("--score-id", required=True, help="学分项 scoreId")
    send_credit_signup.add_argument("--signup-id", nargs="+", required=True, help="报名记录 signUpId，可传多个")
    send_credit_signup.add_argument("--yes", action="store_true", help="跳过确认")
    _add_json_option(send_credit_signup)

    import_export_url = subparsers.add_parser("import-export-url", help="导入导出 URL 中的登录态")
    import_export_url.add_argument("--url", required=True, help="管理活动导出后跳转到浏览器的 URL")
    _add_json_option(import_export_url)

    return parser


def _activity_records(activities: dict[str, Any]) -> list[dict[str, Any]]:
    records = []
    for activity_id, activity in activities.items():
        if isinstance(activity, dict):
            record = dict(activity)
        else:
            record = {"value": activity}
        record.setdefault("activityId", activity_id)
        records.append(record)
    return records


def _require_success(value: Any, message: str) -> Any:
    if value is None or value is False:
        raise RuntimeError(message)
    return value


def _confirmation_token(args: argparse.Namespace) -> str:
    if args.command == "resign":
        count = "all" if args.all else str(len(args.signup_id or []))
    elif args.command == "send-credit":
        count = str(len(args.user_id))
    elif args.command == "send-credit-signup":
        count = str(len(args.signup_id))
    else:
        count = "0"
    return f"EXECUTE {args.command} {args.activity_id} {count}"


def _confirm_or_cancel(
    args: argparse.Namespace,
    *,
    input_func: Callable[[str], str],
    output_stream: TextIO,
) -> bool:
    if args.command not in MUTATING_COMMANDS or args.yes:
        return True

    token = _confirmation_token(args)
    print("这是写操作，会修改线上数据。", file=output_stream)
    print(f"输入 {token} 确认执行：", file=output_stream)
    return input_func("") == token


def _print_success(
    payload: dict[str, Any],
    args: argparse.Namespace,
    output_stream: TextIO,
) -> None:
    print_result(payload, as_json=bool(getattr(args, "as_json", False)), stream=output_stream)


def _handle_read_command(
    args: argparse.Namespace,
    dmapi: DMAPI,
    output_stream: TextIO,
) -> int:
    if args.command == "activities":
        activities = _require_success(dmapi.get_mime_manage_activity_dict(), "无法读取可管理活动")
        records = _activity_records(activities)
        _print_success(
            {
                "success": True,
                "command": args.command,
                "message": f"共 {len(records)} 个可管理活动：",
                "records": records,
                "preferred_fields": ["activityId", "name", "title", "status", "state"],
                "data": activities,
            },
            args,
            output_stream,
        )
        return 0

    if args.command == "sign-id":
        sign_id = _require_success(dmapi.get_signid(args.activity_id), "无法读取签到卡 ID")
        _print_success(
            {
                "success": True,
                "command": args.command,
                "message": "签到卡 ID：",
                "value": sign_id,
                "data": {"activity_id": args.activity_id, "sign_id": sign_id},
            },
            args,
            output_stream,
        )
        return 0

    if args.command == "sign-list":
        sign_type = SIGN_TYPE_CHOICES[args.type]
        records = _require_success(dmapi.get_sign_list(args.activity_id, sign_type), "无法读取签到名单")
        _print_success(
            {
                "success": True,
                "command": args.command,
                "message": f"共 {len(records)} 条签到记录：",
                "records": records,
                "preferred_fields": ["signUpId", "userId", "name", "studentId", "mobile"],
                "data": records,
            },
            args,
            output_stream,
        )
        return 0

    if args.command == "credit-types":
        records = _require_success(dmapi.get_creditType_list(args.activity_id), "无法读取学分项")
        _print_success(
            {
                "success": True,
                "command": args.command,
                "message": f"共 {len(records)} 个学分项：",
                "records": records,
                "preferred_fields": ["scoreId", "creditId", "scorename", "unitcount", "num", "providenum"],
                "data": records,
            },
            args,
            output_stream,
        )
        return 0

    if args.command == "credit-list":
        url = CREDIT_LIST_KIND_CHOICES[args.kind]
        records = _require_success(
            dmapi.get_credit_list(url, args.activity_id, args.score_id),
            "无法读取学分名单",
        )
        _print_success(
            {
                "success": True,
                "command": args.command,
                "message": f"共 {len(records)} 条学分名单记录：",
                "records": records,
                "preferred_fields": ["userId", "signUpId", "name", "studentId", "scoreId"],
                "data": records,
            },
            args,
            output_stream,
        )
        return 0

    if args.command == "import-export-url":
        uid, token = dmapi.get_uid_and_token_from_export_url(args.url)
        _print_success(
            {
                "success": True,
                "command": args.command,
                "message": "登录态导入成功。",
                "data": {
                    "uid": uid,
                    "token_saved": bool(token),
                },
            },
            args,
            output_stream,
        )
        return 0

    return 1


def _handle_export_command(
    args: argparse.Namespace,
    dmapi: DMAPI,
    output_stream: TextIO,
) -> int:
    export_type = EXPORT_TYPE_CHOICES[args.type]
    content = _require_success(
        dmapi.export_mem_excel(args.activity_id, export_type),
        "无法导出成员 Excel",
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(content)
    _print_success(
        {
            "success": True,
            "command": args.command,
            "message": f"导出成功：{output_path}",
            "data": {
                "path": output_path,
                "bytes": len(content),
            },
        },
        args,
        output_stream,
    )
    return 0


def _handle_mutating_command(
    args: argparse.Namespace,
    dmapi: DMAPI,
    output_stream: TextIO,
) -> int:
    if args.command == "resign":
        sign_up_ids = [] if args.all else args.signup_id
        result = _require_success(
            dmapi.resign(args.activity_id, sign_up_ids, args.all),
            "补签失败",
        )
        count = "all" if args.all else len(sign_up_ids)
        _print_success(
            {
                "success": True,
                "command": args.command,
                "message": f"补签完成：activity_id={args.activity_id}, count={count}",
                "data": result,
            },
            args,
            output_stream,
        )
        return 0

    if args.command == "send-credit":
        user_list = ",".join(args.user_id)
        result = _require_success(
            dmapi.send_credit(args.activity_id, args.score_id, user_list),
            "发放学分失败",
        )
        _print_success(
            {
                "success": True,
                "command": args.command,
                "message": f"发放学分完成：activity_id={args.activity_id}, score_id={args.score_id}, count={len(args.user_id)}",
                "data": result,
            },
            args,
            output_stream,
        )
        return 0

    if args.command == "send-credit-signup":
        result = _require_success(
            dmapi.send_creditBy_signUpId(args.activity_id, args.score_id, args.signup_id),
            "按 signUpId 发放学分失败",
        )
        _print_success(
            {
                "success": True,
                "command": args.command,
                "message": f"按 signUpId 发放学分完成：activity_id={args.activity_id}, score_id={args.score_id}, count={len(args.signup_id)}",
                "data": result,
            },
            args,
            output_stream,
        )
        return 0

    return 1


def main(
    argv: list[str] | None = None,
    *,
    dmapi_factory: Callable[[str], DMAPI] | None = None,
    input_func: Callable[[str], str] = input,
    output_stream: TextIO | None = None,
    error_stream: TextIO | None = None,
) -> int:
    if output_stream is None:
        import sys

        output_stream = sys.stdout
    if error_stream is None:
        import sys

        error_stream = sys.stderr

    args = build_parser().parse_args(argv)

    if not _confirm_or_cancel(args, input_func=input_func, output_stream=output_stream):
        print("已取消执行。", file=output_stream)
        return 1

    factory = dmapi_factory or DMAPI

    try:
        dmapi = factory(args.config)
        if args.command in MUTATING_COMMANDS:
            return _handle_mutating_command(args, dmapi, output_stream)
        if args.command == "export-members":
            return _handle_export_command(args, dmapi, output_stream)
        return _handle_read_command(args, dmapi, output_stream)
    except ValueError as exc:
        print(f"错误：{exc}", file=error_stream)
        return 2
    except RuntimeError as exc:
        print(f"错误：{exc}", file=error_stream)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
