from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path
from zipfile import BadZipFile

from openpyxl.utils.exceptions import InvalidFileException

from .eligibility import parse_admit_members
from .reports import write_execution_reports
from .sign_card import has_activity_sign_card

RECOVERABLE_READ_EXCEPTIONS = (RuntimeError, OSError)
MISSING_SIGN_CARD_NOTE = "Activity has no sign card; skipped"


@dataclass(frozen=True, slots=True)
class PlannedMember:
    activity_id: str
    activity_name: str
    credit_type: str
    student_id: str
    student_name: str
    sign_up_id: str
    user_id: str


@dataclass(frozen=True, slots=True)
class PlannedCreditItem:
    credit_id: str
    score_id: str
    credit_type: str
    unitcount_cent: int


@dataclass(frozen=True, slots=True)
class ExecutionAction:
    activity_id: str
    activity_name: str
    credit_type: str
    credit_items: tuple[PlannedCreditItem, ...]
    members: tuple[PlannedMember, ...]


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    batch_dir: Path
    resign_successes: tuple[dict, ...]
    issue_successes: tuple[dict, ...]
    retry_successes: tuple[dict, ...]
    final_failures: tuple[dict, ...]
    admit_conflicts: tuple[dict, ...]
    capacity_conflicts: tuple[dict, ...]
    already_partially_issued: tuple[dict, ...]
    already_fully_issued: tuple[dict, ...]

    @property
    def resign_success_count(self) -> int:
        return len(self.resign_successes)

    @property
    def issue_success_count(self) -> int:
        return len(self.issue_successes)

    @property
    def retry_success_count(self) -> int:
        return len(self.retry_successes)

    @property
    def final_failure_count(self) -> int:
        return len(self.final_failures)

    @property
    def total_failure_count(self) -> int:
        return (
            self.admit_conflict_count
            + self.capacity_conflict_count
            + self.final_failure_count
        )

    @staticmethod
    def _student_key(record: dict) -> tuple[str, str, str, str]:
        return (
            str(record.get("activity_id", "")),
            str(record.get("student_id", "")),
            str(record.get("student_name", "")),
            str(record.get("credit_type", "")),
        )

    @staticmethod
    def _person_key(record: dict) -> tuple[str, str]:
        return (
            str(record.get("student_id", "")),
            str(record.get("student_name", "")),
        )

    @property
    def issue_success_student_count(self) -> int:
        return len({self._person_key(record) for record in self.issue_successes})

    @property
    def capacity_conflict_student_count(self) -> int:
        return len({self._student_key(record) for record in self.capacity_conflicts})

    @property
    def total_failure_student_count(self) -> int:
        records = self.admit_conflicts + self.capacity_conflicts + self.final_failures
        return len({self._student_key(record) for record in records})

    @property
    def admit_conflict_count(self) -> int:
        return len(self.admit_conflicts)

    @property
    def capacity_conflict_count(self) -> int:
        return len(self.capacity_conflicts)

    @property
    def already_partially_issued_count(self) -> int:
        return len(self.already_partially_issued)

    @property
    def already_fully_issued_count(self) -> int:
        return len(self.already_fully_issued)

    def to_report_payload(self) -> dict[str, tuple[dict, ...]]:
        return {
            "resign_successes": self.resign_successes,
            "issue_successes": self.issue_successes,
            "retry_successes": self.retry_successes,
            "final_failures": self.final_failures,
            "admit_conflicts": self.admit_conflicts,
            "capacity_conflicts": self.capacity_conflicts,
            "already_partially_issued": self.already_partially_issued,
            "already_fully_issued": self.already_fully_issued,
        }


def _record(
    member: PlannedMember,
    *,
    credit_id: str = "",
    note: str = "",
) -> dict:
    return {
        "activity_id": member.activity_id,
        "activity_name": member.activity_name,
        "credit_type": member.credit_type,
        "student_id": member.student_id,
        "student_name": member.student_name,
        "sign_up_id": member.sign_up_id,
        "user_id": member.user_id,
        "credit_id": credit_id,
        "note": note,
    }


def _resolve_plan_source(plan_source) -> tuple[dict, Path | None]:
    if isinstance(plan_source, (str, Path)):
        plan_path = Path(plan_source)
        payload = json.loads(plan_path.read_text(encoding="utf-8"))
        return payload, plan_path.parent
    return plan_source, None


def _resolve_batch_dir(
    plan_source,
    output_dir,
) -> tuple[dict, Path]:
    payload, default_batch_dir = _resolve_plan_source(plan_source)
    if output_dir is not None:
        batch_dir = Path(output_dir)
    elif default_batch_dir is not None:
        batch_dir = default_batch_dir
    else:
        raise ValueError("output_dir is required when plan_source is not a file path")
    batch_dir.mkdir(parents=True, exist_ok=True)
    return payload, batch_dir


def _build_actions(plan_payload: dict) -> tuple[ExecutionAction, ...]:
    grouped: dict[
        tuple[str, str, str, tuple[str, ...]],
        dict[str, object],
    ] = {}

    for allocation in plan_payload.get("allocations", []):
        demand = allocation["demand"]
        for assignment in allocation.get("assignments", []):
            bundle = assignment["bundle"]
            credit_items = tuple(
                PlannedCreditItem(
                    credit_id=str(item["credit_id"]),
                    score_id=str(item["score_id"]),
                    credit_type=str(item["credit_type"]),
                    unitcount_cent=int(item["unitcount_cent"]),
                )
                for item in bundle["credit_items"]
            )
            key = (
                str(bundle["activity_id"]),
                str(bundle["activity_name"]),
                str(bundle["credit_type"]),
                tuple(item.credit_id for item in credit_items),
            )
            grouped.setdefault(
                key,
                {
                    "activity_id": str(bundle["activity_id"]),
                    "activity_name": str(bundle["activity_name"]),
                    "credit_type": str(bundle["credit_type"]),
                    "credit_items": credit_items,
                    "members": {},
                },
            )
            grouped[key]["members"][
                str(assignment["sign_up_id"])
            ] = PlannedMember(
                activity_id=str(bundle["activity_id"]),
                activity_name=str(bundle["activity_name"]),
                credit_type=str(bundle["credit_type"]),
                student_id=str(demand["student_id"]),
                student_name=str(demand["student_name"]),
                sign_up_id=str(assignment["sign_up_id"]),
                user_id=str(assignment["user_id"]),
            )

    actions = []
    for group in grouped.values():
        members = tuple(group["members"].values())
        actions.append(
            ExecutionAction(
                activity_id=group["activity_id"],
                activity_name=group["activity_name"],
                credit_type=group["credit_type"],
                credit_items=group["credit_items"],
                members=members,
            )
        )
    return tuple(actions)


def _recoverable_admit_members(dmapi, activity_id: str, retry_attempts: int):
    last_error: Exception | None = None
    for _ in range(retry_attempts):
        try:
            content = dmapi.export_mem_excel(activity_id, dmapi.EXPORT_TYPE_ADMIT)
        except Exception as exc:  # pragma: no cover - network style failure
            last_error = exc
            continue

        if not content:
            last_error = ValueError("Admit list export returned no content")
            continue

        try:
            return parse_admit_members(content)
        except ValueError:
            raise
        except (BadZipFile, InvalidFileException, OSError) as exc:
            last_error = exc
            continue

    if last_error is not None:
        raise last_error
    return ()


def _unsigned_sign_up_ids(dmapi, activity_id: str) -> set[str]:
    if not hasattr(dmapi, "get_sign_list"):
        raise RuntimeError("DMAPI does not support sign list reads")
    sign_type = getattr(dmapi, "SIGN_TYPE_UNSIGNED", 1)
    unsigned = dmapi.get_sign_list(activity_id, sign_type)
    if unsigned is None:
        raise RuntimeError("Failed to fetch unsigned sign list")
    return {str(user["signUpId"]) for user in unsigned}


def _unsigned_sign_up_ids_with_retry(
    dmapi,
    activity_id: str,
    retry_attempts: int,
) -> tuple[set[str] | None, bool]:
    had_retry = False
    for attempt in range(retry_attempts):
        try:
            return _unsigned_sign_up_ids(dmapi, activity_id), had_retry
        except RECOVERABLE_READ_EXCEPTIONS:
            had_retry = True
            continue
    return None, had_retry


def _credited_sign_up_ids(dmapi, activity_id: str, credit_id: str) -> set[str]:
    credited = dmapi.get_credit_list(dmapi.CREDIT_URL_CREDITEDMEM, activity_id, credit_id)
    if credited is None:
        raise RuntimeError("Failed to fetch credited members")
    return {str(user["signUpId"]) for user in credited}


def _credited_sign_up_ids_with_retry(
    dmapi,
    activity_id: str,
    credit_id: str,
    retry_attempts: int,
) -> tuple[set[str] | None, bool]:
    had_retry = False
    for attempt in range(retry_attempts):
        try:
            return _credited_sign_up_ids(dmapi, activity_id, credit_id), had_retry
        except RECOVERABLE_READ_EXCEPTIONS:  # pragma: no cover - exercised by read retry tests
            had_retry = True
    return None, had_retry


def _activity_has_sign_card_with_retry(
    dmapi,
    activity_id: str,
    retry_attempts: int,
) -> tuple[bool | None, bool]:
    had_retry = False
    for _ in range(retry_attempts):
        try:
            return has_activity_sign_card(dmapi, activity_id), had_retry
        except RECOVERABLE_READ_EXCEPTIONS:
            had_retry = True
            continue
    return None, had_retry


def _has_cjk_characters(value: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in value)


def _looks_like_invalid_user_id(user_id: str) -> bool:
    text = user_id.strip()
    return (not text) or _has_cjk_characters(text)


def _sign_up_user_id_map(dmapi, activity_id: str) -> dict[str, str]:
    if not hasattr(dmapi, "get_sign_list"):
        raise RuntimeError("DMAPI does not support sign list reads")

    sign_types: list[int] = []
    for sign_type_name in (
        "SIGN_TYPE_SIGNED",
        "SIGN_TYPE_UNSIGNED",
        "SIGN_TYPE_SIGNOUT",
        "SIGN_TYPE_LEAVE",
    ):
        if hasattr(dmapi, sign_type_name):
            sign_types.append(int(getattr(dmapi, sign_type_name)))
    if not sign_types:
        sign_types = [2, 1]

    mapping: dict[str, str] = {}
    for sign_type in dict.fromkeys(sign_types):
        users = dmapi.get_sign_list(activity_id, sign_type)
        if users is None:
            raise RuntimeError("Failed to fetch sign list")
        for user in users:
            sign_up_id = str(user.get("signUpId", "")).strip()
            user_id = str(user.get("userId", "")).strip()
            if sign_up_id and user_id:
                mapping[sign_up_id] = user_id
    return mapping


def _sign_up_user_id_map_with_retry(
    dmapi,
    activity_id: str,
    retry_attempts: int,
) -> tuple[dict[str, str] | None, bool]:
    had_retry = False
    for attempt in range(retry_attempts):
        try:
            return _sign_up_user_id_map(dmapi, activity_id), had_retry
        except RECOVERABLE_READ_EXCEPTIONS:
            had_retry = True
            continue
    return None, had_retry


def _resign_members_with_retry(
    dmapi,
    activity_id: str,
    members: tuple[PlannedMember, ...],
    retry_attempts: int,
) -> tuple[tuple[PlannedMember, ...], tuple[PlannedMember, ...], bool]:
    if not members:
        return (), (), False

    remaining = {member.sign_up_id: member for member in members}
    had_retry = False
    for attempt in range(retry_attempts):
        try:
            result = dmapi.resign(
                activity_id,
                [member.sign_up_id for member in remaining.values()],
                False,
            )
        except Exception:  # pragma: no cover - network style failure
            result = False

        if attempt > 0:
            had_retry = True

        if result:
            unsigned_after, read_had_retry = _unsigned_sign_up_ids_with_retry(
                dmapi, activity_id, retry_attempts
            )
            had_retry = had_retry or read_had_retry
            if unsigned_after is None:
                return (), members, had_retry
            remaining = {
                sign_up_id: member
                for sign_up_id, member in remaining.items()
                if sign_up_id in unsigned_after
            }
            if not remaining:
                return members, (), had_retry

        had_retry = True

    failed = tuple(remaining.values())
    succeeded = tuple(
        member for member in members if member.sign_up_id not in remaining
    )
    return succeeded, failed, had_retry


def _issue_credit_with_retry(
    dmapi,
    activity_id: str,
    credit_id: str,
    members: tuple[PlannedMember, ...],
    retry_attempts: int,
) -> tuple[
    tuple[PlannedMember, ...],
    tuple[PlannedMember, ...],
    tuple[PlannedMember, ...],
    bool,
]:
    if not members:
        return (), (), (), False

    remaining = list(members)
    succeeded: list[PlannedMember] = []
    had_retry = False

    for attempt in range(retry_attempts):
        user_list = ",".join(member.user_id for member in remaining if member.user_id)
        if not user_list:
            break

        try:
            result = dmapi.send_credit(activity_id, credit_id, user_list)
        except Exception:  # pragma: no cover - network style failure
            result = False

        if attempt > 0:
            had_retry = True

        credited_after, read_had_retry = _credited_sign_up_ids_with_retry(
            dmapi, activity_id, credit_id, retry_attempts
        )
        had_retry = had_retry or read_had_retry
        if credited_after is None:
            return tuple(succeeded), (), tuple(remaining), had_retry

        current_successes = [
            member for member in remaining if member.sign_up_id in credited_after
        ]
        if current_successes:
            succeeded.extend(current_successes)

        remaining = [
            member for member in remaining if member.sign_up_id not in credited_after
        ]
        if result and not remaining:
            return tuple(succeeded), (), (), had_retry

        if remaining:
            had_retry = True

    return tuple(succeeded), tuple(remaining), (), had_retry


def _summary_key(
    student_id: str,
    student_name: str,
    credit_type: str,
) -> tuple[str, str, str]:
    return (student_id, student_name, credit_type)


def _build_final_student_summary_rows(
    plan_payload: dict,
    actual_credit_keys: dict[tuple[str, str, str], set[tuple[str, str, int]]],
    partial_preissued_keys: set[tuple[str, str, str]],
    full_preissued_keys: set[tuple[str, str, str]],
    execution_failure_keys: set[tuple[str, str, str]],
    not_in_admit_keys: set[tuple[str, str, str]],
) -> list[tuple[object, ...]]:
    rows: list[tuple[object, ...]] = []
    for demand in plan_payload.get("demands", []):
        key = _summary_key(
            str(demand["student_id"]),
            str(demand["student_name"]),
            str(demand["credit_type"]),
        )
        requested_value_cent = int(demand["requested_value_cent"])
        actual_value_cent = sum(value for _, _, value in actual_credit_keys.get(key, set()))
        delta_cent = actual_value_cent - requested_value_cent

        if key in not_in_admit_keys:
            status = "不在录取名单"
        elif delta_cent > 0:
            status = "多发"
        elif delta_cent < 0 and key in execution_failure_keys:
            status = "执行失败"
        elif delta_cent < 0:
            status = "少发"
        elif key in full_preissued_keys:
            status = "已全部发放"
        elif key in partial_preissued_keys:
            status = "已部分发放"
        else:
            status = "精确完成"

        rows.append(
            (
                key[0],
                key[1],
                key[2],
                requested_value_cent,
                actual_value_cent,
                delta_cent,
                status,
            )
        )
    return rows


def execute_plan(
    dmapi,
    plan_source,
    output_dir=None,
    retry_attempts: int = 3,
) -> ExecutionResult:
    plan_payload, batch_dir = _resolve_batch_dir(plan_source, output_dir)
    actions = _build_actions(plan_payload)

    resign_successes: list[dict] = []
    issue_successes: list[dict] = []
    retry_successes: list[dict] = []
    final_failures: list[dict] = []
    admit_conflicts: list[dict] = []
    capacity_conflicts: list[dict] = []
    already_partially_issued: list[dict] = []
    already_fully_issued: list[dict] = []
    not_in_admit_keys = {
        _summary_key(
            str(demand["student_id"]),
            str(demand["student_name"]),
            str(demand["credit_type"]),
        )
        for demand in plan_payload.get("not_in_admit_list", [])
    }
    actual_credit_keys: dict[tuple[str, str, str], set[tuple[str, str, int]]] = {}
    partial_preissued_keys: set[tuple[str, str, str]] = set()
    full_preissued_keys: set[tuple[str, str, str]] = set()
    execution_failure_keys: set[tuple[str, str, str]] = set()
    sign_up_user_id_cache: dict[str, dict[str, str]] = {}
    sign_card_cache: dict[str, bool | None] = {}

    def record_actual_credit(member: PlannedMember, credit_item: PlannedCreditItem) -> None:
        key = _summary_key(member.student_id, member.student_name, member.credit_type)
        actual_credit_keys.setdefault(key, set()).add(
            (member.activity_id, credit_item.credit_id, credit_item.unitcount_cent)
        )

    for action in actions:
        has_sign_card = sign_card_cache.get(action.activity_id)
        if action.activity_id not in sign_card_cache:
            has_sign_card, _ = _activity_has_sign_card_with_retry(
                dmapi, action.activity_id, retry_attempts
            )
            sign_card_cache[action.activity_id] = has_sign_card

        if has_sign_card is False:
            for member in action.members:
                execution_failure_keys.add(
                    _summary_key(member.student_id, member.student_name, member.credit_type)
                )
                final_failures.append(_record(member, note=MISSING_SIGN_CARD_NOTE))
            continue

        if has_sign_card is None:
            for member in action.members:
                execution_failure_keys.add(
                    _summary_key(member.student_id, member.student_name, member.credit_type)
                )
                final_failures.append(
                    _record(member, note="Failed to verify sign card before execution")
                )
            continue

        admit_members = _recoverable_admit_members(
            dmapi, action.activity_id, retry_attempts
        )
        admit_lookup = {
            (member.student_id, member.student_name): member for member in admit_members
        }

        eligible_members: list[PlannedMember] = []
        for member in action.members:
            current_member = admit_lookup.get((member.student_id, member.student_name))
            if current_member is None or current_member.sign_up_id != member.sign_up_id:
                execution_failure_keys.add(
                    _summary_key(member.student_id, member.student_name, member.credit_type)
                )
                admit_conflicts.append(
                    _record(member, note="Student is no longer in the admit list")
                )
                continue

            resolved_user_id = member.user_id
            if _looks_like_invalid_user_id(resolved_user_id):
                sign_up_user_map = sign_up_user_id_cache.get(action.activity_id)
                if sign_up_user_map is None:
                    sign_up_user_map, _ = _sign_up_user_id_map_with_retry(
                        dmapi, action.activity_id, retry_attempts
                    )
                    if sign_up_user_map is None:
                        sign_up_user_map = {}
                    sign_up_user_id_cache[action.activity_id] = sign_up_user_map
                mapped_user_id = sign_up_user_map.get(member.sign_up_id, "").strip()
                if mapped_user_id:
                    resolved_user_id = mapped_user_id

            if _looks_like_invalid_user_id(resolved_user_id):
                execution_failure_keys.add(
                    _summary_key(member.student_id, member.student_name, member.credit_type)
                )
                final_failures.append(
                    _record(member, note="Unable to resolve valid user ID for credit issue")
                )
                continue

            eligible_members.append(replace(member, user_id=resolved_user_id.strip()))

        if not eligible_members:
            continue

        credited_by_item = {
            credit_item.credit_id: set() for credit_item in action.credit_items
        }
        pre_read_failed_members: list[PlannedMember] = []
        for credit_item in action.credit_items:
            credited_before, _ = _credited_sign_up_ids_with_retry(
                dmapi, action.activity_id, credit_item.credit_id, retry_attempts
            )
            if credited_before is None:
                pre_read_failed_members.extend(eligible_members)
                final_failures.extend(
                    _record(
                        member,
                        credit_id=credit_item.credit_id,
                        note="Failed to read credited members before issue",
                    )
                    for member in eligible_members
                )
                for member in eligible_members:
                    execution_failure_keys.add(
                        _summary_key(member.student_id, member.student_name, member.credit_type)
                    )
                break
            credited_by_item[credit_item.credit_id] = credited_before
        if pre_read_failed_members:
            continue

        missing_by_member: dict[str, list[str]] = {}
        actionable_members: list[PlannedMember] = []
        for member in eligible_members:
            missing_credit_ids = [
                credit_item.credit_id
                for credit_item in action.credit_items
                if member.sign_up_id not in credited_by_item[credit_item.credit_id]
            ]
            for credit_item in action.credit_items:
                if member.sign_up_id in credited_by_item[credit_item.credit_id]:
                    record_actual_credit(member, credit_item)
            if not missing_credit_ids:
                full_preissued_keys.add(
                    _summary_key(member.student_id, member.student_name, member.credit_type)
                )
                already_fully_issued.append(
                    _record(member, note="All bundle credits already issued")
                )
                continue
            if len(missing_credit_ids) != len(action.credit_items):
                partial_preissued_keys.add(
                    _summary_key(member.student_id, member.student_name, member.credit_type)
                )
                already_partially_issued.append(
                    _record(member, note="Some bundle credits were already issued")
                )
            missing_by_member[member.sign_up_id] = missing_credit_ids
            actionable_members.append(member)

        unsigned_before, sign_read_had_retry = _unsigned_sign_up_ids_with_retry(
            dmapi, action.activity_id, retry_attempts
        )
        if unsigned_before is None:
            for member in actionable_members:
                execution_failure_keys.add(
                    _summary_key(member.student_id, member.student_name, member.credit_type)
                )
            final_failures.extend(
                _record(member, note="Failed to read sign list before resign")
                for member in actionable_members
            )
            continue

        unsigned_targets = tuple(
            member
            for member in actionable_members
            if member.sign_up_id in unsigned_before
        )
        resigned_members, resign_failed_members, resign_had_retry = _resign_members_with_retry(
            dmapi,
            action.activity_id,
            unsigned_targets,
            retry_attempts,
        )
        for member in resigned_members:
            resign_successes.append(_record(member, note="Resigned before credit issue"))
            if resign_had_retry or sign_read_had_retry:
                retry_successes.append(_record(member, note="Resign succeeded after retry"))
        for member in resign_failed_members:
            execution_failure_keys.add(
                _summary_key(member.student_id, member.student_name, member.credit_type)
            )
            final_failures.append(_record(member, note="Resign failed after retries"))

        actionable_members = [
            member
            for member in actionable_members
            if member.sign_up_id not in {failed.sign_up_id for failed in resign_failed_members}
        ]

        for credit_item in action.credit_items:
            targets = tuple(
                member
                for member in actionable_members
                if credit_item.credit_id in missing_by_member[member.sign_up_id]
            )
            succeeded, state_conflicts, verification_failures, had_retry = _issue_credit_with_retry(
                dmapi,
                action.activity_id,
                credit_item.credit_id,
                targets,
                retry_attempts,
            )
            for member in succeeded:
                record_actual_credit(member, credit_item)
                issue_successes.append(
                    _record(
                        member,
                        credit_id=credit_item.credit_id,
                        note="Credit issued successfully",
                    )
                )
                if had_retry:
                    retry_successes.append(
                        _record(
                            member,
                            credit_id=credit_item.credit_id,
                            note="Credit issue succeeded after retry",
                        )
                    )
            for member in state_conflicts:
                execution_failure_keys.add(
                    _summary_key(member.student_id, member.student_name, member.credit_type)
                )
                capacity_conflicts.append(
                    _record(
                        member,
                        credit_id=credit_item.credit_id,
                        note="Credit state did not update after retries",
                    )
                )
            for member in verification_failures:
                execution_failure_keys.add(
                    _summary_key(member.student_id, member.student_name, member.credit_type)
                )
                final_failures.append(
                    _record(
                        member,
                        credit_id=credit_item.credit_id,
                        note="Failed to verify credit issue after retries",
                    )
                )

    result = ExecutionResult(
        batch_dir=batch_dir,
        resign_successes=tuple(resign_successes),
        issue_successes=tuple(issue_successes),
        retry_successes=tuple(retry_successes),
        final_failures=tuple(final_failures),
        admit_conflicts=tuple(admit_conflicts),
        capacity_conflicts=tuple(capacity_conflicts),
        already_partially_issued=tuple(already_partially_issued),
        already_fully_issued=tuple(already_fully_issued),
    )
    final_student_summary_rows = _build_final_student_summary_rows(
        plan_payload,
        actual_credit_keys,
        partial_preissued_keys,
        full_preissued_keys,
        execution_failure_keys,
        not_in_admit_keys,
    )
    write_execution_reports(
        batch_dir,
        result.to_report_payload(),
        final_student_summary_rows,
    )
    return result
