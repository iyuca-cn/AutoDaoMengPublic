import pytest
from openpyxl import Workbook

from credit_workflow.models import DemandRecord
from credit_workflow.input_excel import (
    PriorityDemandRecord,
    load_and_aggregate_demands,
    load_and_aggregate_priority_demands,
    parse_input_workbook,
    parse_priority_input_workbook,
)


def build_input_workbook(headers=None, rows=None):
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(headers or ["姓名", "学号", "学分类型", "学分数值"])

    for row in rows or []:
        sheet.append(row)

    return workbook


def test_detects_required_columns_by_header_name():
    workbook = build_input_workbook(
        headers=["学分数值", "姓名", "学号", "学分类型"],
        rows=[["0.20", "张三", "20250001", "美育实践学分"]],
    )

    rows = parse_input_workbook(workbook)

    assert rows[0].student_id == "20250001"
    assert rows[0].student_name == "张三"
    assert rows[0].credit_type == "美育实践学分"
    assert rows[0].requested_value_cent == 20


def test_aggregates_by_student_id_and_credit_type():
    workbook = build_input_workbook(
        rows=[
            ["张三", "20250001", "美育实践学分", "0.20"],
            ["张三", "20250001", "美育实践学分", "0.30"],
            ["张三", "20250001", "劳动教育学分", "0.10"],
        ]
    )

    demands = load_and_aggregate_demands(workbook)

    assert demands == [
        DemandRecord(
            student_id="20250001",
            student_name="张三",
            credit_type="劳动教育学分",
            requested_value_cent=10,
        ),
        DemandRecord(
            student_id="20250001",
            student_name="张三",
            credit_type="美育实践学分",
            requested_value_cent=50,
        ),
    ]


def test_parses_multiple_credit_types_as_ordered_priority_total():
    workbook = build_input_workbook(
        rows=[["张三", "20250001", "劳动教育学分，美育实践学分", "0.50"]]
    )

    rows = parse_priority_input_workbook(workbook)

    assert rows == [
        PriorityDemandRecord(
            student_id="20250001",
            student_name="张三",
            credit_types=("劳动教育学分", "美育实践学分"),
            requested_value_cent=50,
        )
    ]


def test_aggregates_priority_demands_by_student_and_ordered_credit_types():
    workbook = build_input_workbook(
        rows=[
            ["张三", "20250001", "劳动教育学分，美育实践学分", "0.20"],
            ["张三", "20250001", "劳动教育学分，美育实践学分", "0.30"],
        ]
    )

    demands = load_and_aggregate_priority_demands(workbook)

    assert demands == [
        PriorityDemandRecord(
            student_id="20250001",
            student_name="张三",
            credit_types=("劳动教育学分", "美育实践学分"),
            requested_value_cent=50,
        )
    ]


def test_skips_blank_rows_in_input_workbook():
    workbook = build_input_workbook(
        rows=[
            ["张三", "20250001", "美育实践学分", "0.20"],
            [None, None, None, None],
        ]
    )

    rows = parse_input_workbook(workbook)

    assert rows == [
        DemandRecord(
            student_id="20250001",
            student_name="张三",
            credit_type="美育实践学分",
            requested_value_cent=20,
        )
    ]


def test_rejects_credit_values_finer_than_cent_units():
    workbook = build_input_workbook(
        rows=[["张三", "20250001", "美育实践学分", "0.205"]]
    )

    with pytest.raises(ValueError, match="increments of 0.01"):
        parse_input_workbook(workbook)
