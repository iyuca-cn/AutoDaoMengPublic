from __future__ import annotations

import argparse
import json
from pathlib import Path

from DMAPI.DMAPI import DMAPI

from credit_workflow.executor import execute_plan
from credit_workflow.workflow import run_plan_workflow
from random_drain.workflow import run_random_drain_workflow


DEFAULT_CONFIG_PATH = "config.ini"


def _records_from_payload(payload: dict, key: str) -> list[dict]:
    records = payload.get(key, [])
    if not isinstance(records, list):
        return []
    return [record for record in records if isinstance(record, dict)]


def _count_people(records: list[dict]) -> int:
    people = set()
    for record in records:
        student_id = str(record.get("student_id", "")).strip()
        student_name = str(record.get("student_name", "")).strip()
        if student_id or student_name:
            people.add((student_id, student_name))
    return len(people)


def _count_issue_actions(allocations: list[dict]) -> int:
    total = 0
    for allocation in allocations:
        assignments = allocation.get("assignments", [])
        if isinstance(assignments, list):
            total += len(assignments)
    return total


def _build_plan_natural_summary(plan_path: str) -> str:
    try:
        payload = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "计划摘要：无法读取计划内容，将按原计划文件继续执行。"
    if not isinstance(payload, dict):
        return "计划摘要：计划内容格式异常，将按原计划文件继续执行。"

    demands = _records_from_payload(payload, "demands")
    bundles = _records_from_payload(payload, "bundles")
    allocations = _records_from_payload(payload, "allocations")
    not_in_admit_list = _records_from_payload(payload, "not_in_admit_list")
    activity_count = len(
        {
            str(bundle.get("activity_id", "")).strip()
            for bundle in bundles
            if str(bundle.get("activity_id", "")).strip()
        }
    )
    issue_actions = _count_issue_actions(allocations)
    generated_at = str(payload.get("generated_at", "")).strip()
    summary_prefix = (
        f"计划摘要（生成时间：{generated_at}）："
        if generated_at
        else "计划摘要："
    )
    return (
        f"{summary_prefix}"
        f"本次共有{len(demands)}条需求，涉及{_count_people(demands)}人；"
        f"共匹配{activity_count}个活动、{len(bundles)}个活动包，预计执行{issue_actions}次发放；"
        f"执行期不在录取名单{len(not_in_admit_list)}条，涉及{_count_people(not_in_admit_list)}人。"
    )


def _planned_not_in_admit_list(plan_path: str) -> list[dict]:
    try:
        payload = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(payload, dict):
        return []
    return _records_from_payload(payload, "not_in_admit_list")


def _planned_issue_action_count(plan_path: str) -> int | None:
    try:
        payload = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    allocations = _records_from_payload(payload, "allocations")
    return _count_issue_actions(allocations)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="到梦空间学分工作流：先生成计划，再确认执行。"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan_parser = subparsers.add_parser("plan", help="读取 Excel 并生成发放计划")
    plan_parser.add_argument("--excel", required=True, help="输入 Excel 路径")
    plan_parser.add_argument("--output", required=True, help="输出目录")

    execute_parser = subparsers.add_parser("execute", help="执行冻结后的计划")
    execute_parser.add_argument("--plan", required=True, help="plan.json 路径")

    drain_parser = subparsers.add_parser(
        "random-drain",
        help="随机消耗活动剩余可发名额",
    )
    drain_parser.add_argument(
        "--threshold-percent",
        required=True,
        type=int,
        help="每个活动学分项最终已发放人数阈值百分比",
    )
    drain_parser.add_argument(
        "--jitter-count",
        type=int,
        default=0,
        help="每个学分项目标人数随机加减范围",
    )
    drain_parser.add_argument(
        "--output",
        default="logs/random-drain",
        help="输出目录",
    )
    drain_parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="随机种子，可选",
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "plan":
        dmapi = DMAPI(DEFAULT_CONFIG_PATH)
        result = run_plan_workflow(dmapi, args.excel, args.output)
        print(f"计划已生成：{result.batch_dir}")
        return 0

    if args.command == "random-drain":
        dmapi = DMAPI(DEFAULT_CONFIG_PATH)
        result = run_random_drain_workflow(
            dmapi,
            threshold_percent=args.threshold_percent,
            output_dir=args.output,
            seed=args.seed,
            jitter_count=args.jitter_count,
        )
        print(f"随机消耗执行完成：{result.batch_dir}")
        print(
            f"发放成功 {len(result.successes)}，"
            f"失败 {len(result.failures)}，"
            f"跳过 {len(result.skipped)}。"
        )
        return 0

    print(f"即将执行计划：{args.plan}")
    print(_build_plan_natural_summary(args.plan))
    planned_issue_actions = _planned_issue_action_count(args.plan)
    if planned_issue_actions == 0:
        print("计划无需执行：预计执行0次发放，已自动退出。")
        return 0
    print("输入 EXECUTE 确认开始执行：")
    confirmation = input("")
    if confirmation != "EXECUTE":
        print("已取消执行。")
        return 1

    dmapi = DMAPI(DEFAULT_CONFIG_PATH)
    result = execute_plan(dmapi, args.plan)
    planned_not_in_admit_records = _planned_not_in_admit_list(args.plan)
    planned_not_in_admit_count = len(planned_not_in_admit_records)
    planned_not_in_admit_people = _count_people(planned_not_in_admit_records)
    execution_admit_conflict_count = result.admit_conflict_count
    execution_admit_conflict_people = getattr(
        result, "admit_conflict_student_count", result.admit_conflict_count
    )
    admit_conflict_count = execution_admit_conflict_count + planned_not_in_admit_count
    admit_conflict_people = execution_admit_conflict_people + planned_not_in_admit_people
    capacity_conflict_people = getattr(
        result, "capacity_conflict_student_count", result.capacity_conflict_count
    )
    issue_success_people = getattr(
        result, "issue_success_student_count", result.issue_success_count
    )
    total_failure_count = result.total_failure_count + planned_not_in_admit_count
    total_failure_people = getattr(
        result, "total_failure_student_count", result.total_failure_count
    ) + planned_not_in_admit_people
    admit_conflict_display = (
        f"不在录取名单 {admit_conflict_count}(计划期{planned_not_in_admit_count}+执行期{execution_admit_conflict_count}，涉及{admit_conflict_people}人)，"
        if planned_not_in_admit_count
        else f"执行期不在录取名单 {admit_conflict_count}，"
    )
    print(
        "执行完成："
        f"发放成功 {result.issue_success_count}(涉及{issue_success_people}人)，"
        f"重试成功 {result.retry_success_count}，"
        f"{admit_conflict_display}"
        f"执行期容量冲突 {result.capacity_conflict_count}(条目，涉及{capacity_conflict_people}人)，"
        f"发放最终失败 {result.final_failure_count}，"
        f"总失败 {total_failure_count}(条目，涉及{total_failure_people}人)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
