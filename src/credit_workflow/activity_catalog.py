from __future__ import annotations

from .models import (
    ActivityBundle,
    CreditItem,
    parse_credit_value_to_cent,
    validate_credit_type,
)
from .sign_card import has_activity_sign_card

RECOVERABLE_CATALOG_EXCEPTIONS = (RuntimeError, OSError)


def _load_managed_activities(dmapi, retry_attempts: int) -> dict:
    last_error: Exception | None = None
    for _ in range(max(1, retry_attempts)):
        try:
            activities = dmapi.get_mime_manage_activity_dict()
        except RECOVERABLE_CATALOG_EXCEPTIONS as exc:
            last_error = exc
            continue

        if activities is None:
            last_error = RuntimeError("Failed to fetch managed activities")
            continue
        return activities

    if last_error is not None:
        raise last_error
    return {}


def _load_credit_rows(dmapi, activity_id: str, retry_attempts: int) -> list[dict]:
    last_error: Exception | None = None
    for _ in range(max(1, retry_attempts)):
        try:
            credit_rows = dmapi.get_creditType_list(activity_id)
        except RECOVERABLE_CATALOG_EXCEPTIONS as exc:
            last_error = exc
            continue

        if credit_rows is None:
            last_error = RuntimeError(
                f"Failed to fetch credit rows for activity {activity_id}"
            )
            continue
        return credit_rows

    if last_error is not None:
        raise last_error
    return []


def _activity_has_sign_card(dmapi, activity_id: str, retry_attempts: int) -> bool:
    last_error: Exception | None = None
    for _ in range(max(1, retry_attempts)):
        try:
            return has_activity_sign_card(dmapi, activity_id)
        except RECOVERABLE_CATALOG_EXCEPTIONS as exc:
            last_error = exc
            continue

    if last_error is not None:
        raise last_error
    return False


def build_activity_bundles(dmapi, retry_attempts: int = 3) -> list[ActivityBundle]:
    activities = _load_managed_activities(dmapi, retry_attempts)
    bundles: list[ActivityBundle] = []

    for activity_id, activity in activities.items():
        if not _activity_has_sign_card(dmapi, str(activity_id), retry_attempts):
            continue

        for credit_row in _load_credit_rows(dmapi, str(activity_id), retry_attempts):
            scorename = str(credit_row["scorename"])
            try:
                credit_type = validate_credit_type(scorename)
            except ValueError:
                continue

            item = CreditItem(
                credit_id=str(credit_row["creditId"]),
                score_id=str(credit_row["scoreId"]),
                credit_type=credit_type,
                unitcount_cent=parse_credit_value_to_cent(credit_row["unitcount"]),
                remaining_capacity=int(credit_row["num"]) - int(credit_row["providenum"]),
            )
            bundles.append(
                ActivityBundle(
                    activity_id=str(activity_id),
                    activity_name=str(activity["name"]),
                    credit_type=item.credit_type,
                    bundle_value_cent=item.unitcount_cent,
                    bundle_capacity=item.remaining_capacity,
                    credit_items=(item,),
                )
            )

    return bundles
