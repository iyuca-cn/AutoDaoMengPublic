from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation


SUPPORTED_CREDIT_TYPES = (
    "美育实践学分",
    "思想成长学分",
    "劳动教育学分",
    "体育活动学分",
)


@dataclass(frozen=True, slots=True)
class DemandRecord:
    student_id: str
    student_name: str
    credit_type: str
    requested_value_cent: int


@dataclass(frozen=True, slots=True)
class CreditItem:
    credit_id: str
    score_id: str
    credit_type: str
    unitcount_cent: int
    remaining_capacity: int


@dataclass(frozen=True, slots=True)
class ActivityBundle:
    activity_id: str
    activity_name: str
    credit_type: str
    bundle_value_cent: int
    bundle_capacity: int
    credit_items: tuple[CreditItem, ...]


def normalize_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def validate_credit_type(credit_type: str) -> str:
    if credit_type not in SUPPORTED_CREDIT_TYPES:
        raise ValueError(f"Unsupported credit type: {credit_type}")
    return credit_type


def parse_credit_value_to_cent(value: object) -> int:
    text = normalize_text(value)
    if not text:
        raise ValueError("Credit value is required")

    try:
        decimal_value = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"Invalid credit value: {text}") from exc

    cent_value = decimal_value * 100
    if cent_value != cent_value.to_integral_value():
        raise ValueError("Credit value must be in increments of 0.01")

    return int(cent_value)
