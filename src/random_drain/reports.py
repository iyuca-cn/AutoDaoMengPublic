from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook

from .models import CreditDrainSelection, DrainRecord


def _write_workbook(
    path: Path,
    headers: tuple[str, ...],
    rows: list[tuple[object, ...]],
) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    workbook.save(path)


def _summary_rows(
    selections: tuple[CreditDrainSelection, ...],
) -> list[tuple[object, ...]]:
    return [
        (
            selection.activity_id,
            selection.activity_name,
            selection.credit_type,
            selection.credit_id,
            selection.total_capacity,
            selection.provided_count,
            selection.threshold_percent,
            selection.base_target_count,
            selection.jitter_offset,
            selection.final_target_count,
            selection.candidate_count,
            selection.planned_issue_count,
            selection.status,
            selection.note,
        )
        for selection in selections
    ]


def _record_rows(records: tuple[DrainRecord, ...]) -> list[tuple[object, ...]]:
    return [
        (
            record.activity_id,
            record.activity_name,
            record.credit_type,
            record.credit_id,
            record.sign_up_id,
            record.user_id,
            record.name,
            record.note,
        )
        for record in records
    ]


def write_random_drain_reports(
    batch_dir: Path,
    *,
    selections: tuple[CreditDrainSelection, ...],
    successes: tuple[DrainRecord, ...],
    failures: tuple[DrainRecord, ...],
    skipped: tuple[DrainRecord, ...],
) -> None:
    batch_dir.mkdir(parents=True, exist_ok=True)
    _write_workbook(
        batch_dir / "random_drain_summary.xlsx",
        (
            "activityId",
            "活动名称",
            "学分类型",
            "creditId",
            "总名额",
            "执行前已发放",
            "阈值百分比",
            "基础目标人数",
            "随机偏移人数",
            "最终目标人数",
            "候选人数",
            "本次计划发放",
            "状态",
            "说明",
        ),
        _summary_rows(selections),
    )
    record_headers = (
        "activityId",
        "活动名称",
        "学分类型",
        "creditId",
        "signUpId",
        "userId",
        "姓名",
        "说明",
    )
    _write_workbook(
        batch_dir / "random_drain_successes.xlsx",
        record_headers,
        _record_rows(successes),
    )
    _write_workbook(
        batch_dir / "random_drain_failures.xlsx",
        record_headers,
        _record_rows(failures),
    )
    _write_workbook(
        batch_dir / "random_drain_skipped.xlsx",
        record_headers,
        _record_rows(skipped),
    )
