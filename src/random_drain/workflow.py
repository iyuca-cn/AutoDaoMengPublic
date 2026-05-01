from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from random import Random

from credit_workflow.models import validate_credit_type
from credit_workflow.sign_card import has_activity_sign_card

from .models import (
    ActivityDrainBatch,
    CandidateMember,
    CreditDrainSelection,
    DrainRecord,
    RandomDrainResult,
)
from .reports import write_random_drain_reports


RECOVERABLE_READ_EXCEPTIONS = (RuntimeError, OSError)


@dataclass(frozen=True, slots=True)
class _CreditSelectionDraft:
    selection_without_members: CreditDrainSelection
    candidates: tuple[CandidateMember, ...]
    target_issue_count: int


def calculate_target_count(
    total_capacity: int,
    threshold_percent: int,
    jitter_offset: int = 0,
) -> int:
    raw_target = (
        Decimal(total_capacity) * Decimal(threshold_percent) / Decimal(100)
    )
    base_target = int(raw_target.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return max(0, min(total_capacity, base_target + jitter_offset))


def _validate_target_options(threshold_percent: int, jitter_count: int) -> None:
    if threshold_percent < 0 or threshold_percent > 100:
        raise ValueError("threshold_percent must be between 0 and 100")
    if jitter_count < 0:
        raise ValueError("jitter_count must be greater than or equal to 0")


def _load_with_retry(loader, retry_attempts: int):
    last_error: Exception | None = None
    for _ in range(max(1, retry_attempts)):
        try:
            value = loader()
        except RECOVERABLE_READ_EXCEPTIONS as exc:
            last_error = exc
            continue
        if value is None:
            last_error = RuntimeError("read returned no data")
            continue
        return value
    if last_error is not None:
        raise last_error
    raise RuntimeError("read failed")


def _load_managed_activities(dmapi, retry_attempts: int) -> dict:
    return _load_with_retry(dmapi.get_mime_manage_activity_dict, retry_attempts)


def _load_credit_rows(dmapi, activity_id: str, retry_attempts: int) -> list[dict]:
    return _load_with_retry(
        lambda: dmapi.get_creditType_list(activity_id),
        retry_attempts,
    )


def _load_credit_list(
    dmapi,
    url: str,
    activity_id: str,
    credit_id: str,
    retry_attempts: int,
) -> list[dict]:
    return _load_with_retry(
        lambda: dmapi.get_credit_list(url, activity_id, credit_id),
        retry_attempts,
    )


def _activity_has_sign_card(dmapi, activity_id: str, retry_attempts: int) -> bool:
    return bool(
        _load_with_retry(
            lambda: has_activity_sign_card(dmapi, activity_id),
            retry_attempts,
        )
    )


def _text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _int_value(value: object, default: int = 0) -> int:
    text = _text(value)
    if not text:
        return default
    return int(text)


def _candidate_from_row(row: dict) -> CandidateMember | None:
    sign_up_id = _text(row.get("signUpId"))
    user_id = _text(row.get("userId"))
    if not sign_up_id or not user_id:
        return None
    name = (
        _text(row.get("name"))
        or _text(row.get("studentName"))
        or _text(row.get("realName"))
        or _text(row.get("nickName"))
    )
    return CandidateMember(sign_up_id=sign_up_id, user_id=user_id, name=name)


def _unique_members(rows: list[dict]) -> tuple[CandidateMember, ...]:
    members_by_sign_up_id: dict[str, CandidateMember] = {}
    for row in rows:
        member = _candidate_from_row(row)
        if member is None:
            continue
        members_by_sign_up_id.setdefault(member.sign_up_id, member)
    return tuple(
        members_by_sign_up_id[key]
        for key in sorted(members_by_sign_up_id)
    )


def _credited_sign_up_ids(
    dmapi,
    activity_id: str,
    credit_id: str,
    retry_attempts: int,
) -> set[str]:
    credited = _load_credit_list(
        dmapi,
        dmapi.CREDIT_URL_CREDITEDMEM,
        activity_id,
        credit_id,
        retry_attempts,
    )
    return {_text(row["signUpId"]) for row in credited}


def _build_selection_draft(
    dmapi,
    *,
    activity_id: str,
    activity_name: str,
    credit_row: dict,
    threshold_percent: int,
    jitter_offset: int,
    retry_attempts: int,
) -> _CreditSelectionDraft | None:
    try:
        credit_type = validate_credit_type(_text(credit_row.get("scorename")))
    except ValueError:
        return None

    credit_id = _text(credit_row.get("creditId"))
    total_capacity = _int_value(credit_row.get("num"))
    base_target_count = calculate_target_count(total_capacity, threshold_percent, 0)
    final_target_count = calculate_target_count(
        total_capacity,
        threshold_percent,
        jitter_offset,
    )
    provided_from_row = _int_value(credit_row.get("providenum"))
    credited_sign_up_ids = _credited_sign_up_ids(
        dmapi,
        activity_id,
        credit_id,
        retry_attempts,
    )
    provided_count = max(provided_from_row, len(credited_sign_up_ids))
    if provided_count >= final_target_count:
        return _CreditSelectionDraft(
            selection_without_members=CreditDrainSelection(
                activity_id=activity_id,
                activity_name=activity_name,
                credit_id=credit_id,
                credit_type=credit_type,
                total_capacity=total_capacity,
                provided_count=provided_count,
                threshold=final_target_count,
                selected_members=(),
                candidate_count=0,
                status="threshold_reached",
                note="Threshold already reached",
                threshold_percent=threshold_percent,
                base_target_count=base_target_count,
                jitter_offset=jitter_offset,
                final_target_count=final_target_count,
            ),
            candidates=(),
            target_issue_count=0,
        )

    candidates = _unique_members(
        _load_credit_list(
            dmapi,
            dmapi.CREDIT_URL_CANDIDATES,
            activity_id,
            credit_id,
            retry_attempts,
        )
        + _load_credit_list(
            dmapi,
            dmapi.CREDIT_URL_OTHERMEMS,
            activity_id,
            credit_id,
            retry_attempts,
        )
    )
    candidates = tuple(
        member
        for member in candidates
        if member.sign_up_id not in credited_sign_up_ids
    )
    target_count = final_target_count - provided_count
    if not candidates:
        return _CreditSelectionDraft(
            selection_without_members=CreditDrainSelection(
                activity_id=activity_id,
                activity_name=activity_name,
                credit_id=credit_id,
                credit_type=credit_type,
                total_capacity=total_capacity,
                provided_count=provided_count,
                threshold=final_target_count,
                selected_members=(),
                candidate_count=0,
                status="no_candidates",
                note="No uncredited candidates",
                threshold_percent=threshold_percent,
                base_target_count=base_target_count,
                jitter_offset=jitter_offset,
                final_target_count=final_target_count,
            ),
            candidates=(),
            target_issue_count=target_count,
        )

    return _CreditSelectionDraft(
        selection_without_members=CreditDrainSelection(
            activity_id=activity_id,
            activity_name=activity_name,
            credit_id=credit_id,
            credit_type=credit_type,
            total_capacity=total_capacity,
            provided_count=provided_count,
            threshold=final_target_count,
            selected_members=(),
            candidate_count=len(candidates),
            status="ready",
            note="",
            threshold_percent=threshold_percent,
            base_target_count=base_target_count,
            jitter_offset=jitter_offset,
            final_target_count=final_target_count,
        ),
        candidates=candidates,
        target_issue_count=target_count,
    )


def _assign_activity_members(
    drafts: tuple[_CreditSelectionDraft, ...],
    rng: Random,
) -> tuple[CreditDrainSelection, ...]:
    selected_count_by_sign_up_id: dict[str, int] = {}
    selections: list[CreditDrainSelection] = []
    for draft in drafts:
        if draft.target_issue_count <= 0 or not draft.candidates:
            selections.append(draft.selection_without_members)
            continue

        randomized = list(draft.candidates)
        rng.shuffle(randomized)
        ordered = sorted(
            randomized,
            key=lambda member: selected_count_by_sign_up_id.get(member.sign_up_id, 0),
        )
        selected = tuple(
            sorted(
                ordered[: draft.target_issue_count],
                key=lambda member: member.sign_up_id,
            )
        )
        for member in selected:
            selected_count_by_sign_up_id[member.sign_up_id] = (
                selected_count_by_sign_up_id.get(member.sign_up_id, 0) + 1
            )

        status = (
            "ready"
            if len(selected) >= draft.target_issue_count
            else "candidate_shortage"
        )
        note = "" if status == "ready" else "候选不足，已选择所有可发候选人"
        selections.append(
            replace(
                draft.selection_without_members,
                selected_members=selected,
                status=status,
                note=note,
            )
        )
    return tuple(selections)


def build_random_drain_batches(
    dmapi,
    threshold_percent: int,
    jitter_count: int,
    rng: Random,
    retry_attempts: int = 3,
) -> tuple[ActivityDrainBatch, ...]:
    _validate_target_options(threshold_percent, jitter_count)
    activities = _load_managed_activities(dmapi, retry_attempts)
    batches: list[ActivityDrainBatch] = []
    for raw_activity_id, activity in activities.items():
        activity_id = _text(raw_activity_id)
        activity_name = (
            _text(activity.get("name"))
            or _text(activity.get("activityName"))
            or activity_id
        )
        if not _activity_has_sign_card(dmapi, activity_id, retry_attempts):
            batches.append(
                ActivityDrainBatch(
                    activity_id=activity_id,
                    activity_name=activity_name,
                    selections=(
                        CreditDrainSelection(
                            activity_id=activity_id,
                            activity_name=activity_name,
                            credit_id="",
                            credit_type="",
                            total_capacity=0,
                            provided_count=0,
                            threshold=0,
                            selected_members=(),
                            candidate_count=0,
                            status="no_sign_card",
                            note="Activity has no sign card; skipped",
                            threshold_percent=threshold_percent,
                            base_target_count=0,
                            jitter_offset=0,
                            final_target_count=0,
                        ),
                    ),
                )
            )
            continue

        drafts = []
        for credit_row in _load_credit_rows(dmapi, activity_id, retry_attempts):
            jitter_offset = rng.randint(-jitter_count, jitter_count) if jitter_count else 0
            draft = _build_selection_draft(
                dmapi,
                activity_id=activity_id,
                activity_name=activity_name,
                credit_row=credit_row,
                threshold_percent=threshold_percent,
                jitter_offset=jitter_offset,
                retry_attempts=retry_attempts,
            )
            if draft is not None:
                drafts.append(draft)
        batches.append(
            ActivityDrainBatch(
                activity_id=activity_id,
                activity_name=activity_name,
                selections=_assign_activity_members(tuple(drafts), rng),
            )
        )
    return tuple(batches)


def _record(
    selection: CreditDrainSelection,
    member: CandidateMember | None = None,
    *,
    note: str,
) -> DrainRecord:
    return DrainRecord(
        activity_id=selection.activity_id,
        activity_name=selection.activity_name,
        credit_type=selection.credit_type,
        credit_id=selection.credit_id,
        sign_up_id=member.sign_up_id if member else "",
        user_id=member.user_id if member else "",
        name=member.name if member else "",
        note=note,
    )


def _selection_skip_records(
    selections: tuple[CreditDrainSelection, ...],
) -> tuple[DrainRecord, ...]:
    skipped = []
    for selection in selections:
        if selection.planned_issue_count > 0:
            continue
        if selection.status == "ready":
            continue
        skipped.append(_record(selection, note=selection.note or selection.status))
    return tuple(skipped)


def _activity_unconfirmed_records(batch: ActivityDrainBatch) -> tuple[DrainRecord, ...]:
    return tuple(
        _record(selection, member, note="Activity was not confirmed")
        for selection in batch.selections
        for member in selection.selected_members
    )


def _unsigned_sign_up_ids(dmapi, activity_id: str) -> set[str]:
    unsigned = dmapi.get_sign_list(
        activity_id,
        getattr(dmapi, "SIGN_TYPE_UNSIGNED", 1),
    )
    if unsigned is None:
        raise RuntimeError("Failed to fetch unsigned sign list")
    return {_text(row["signUpId"]) for row in unsigned}


def _read_unsigned_with_retry(
    dmapi,
    activity_id: str,
    retry_attempts: int,
) -> set[str]:
    return _load_with_retry(
        lambda: _unsigned_sign_up_ids(dmapi, activity_id),
        retry_attempts,
    )


def _resign_activity_members(
    dmapi,
    activity_id: str,
    members: tuple[CandidateMember, ...],
    retry_attempts: int,
) -> set[str]:
    if not members:
        return set()

    unsigned_ids = _read_unsigned_with_retry(dmapi, activity_id, retry_attempts)
    targets = sorted(
        {
            member.sign_up_id
            for member in members
            if member.sign_up_id in unsigned_ids
        }
    )
    if not targets:
        return set()

    for _ in range(max(1, retry_attempts)):
        try:
            if dmapi.resign(activity_id, targets, False):
                return set()
        except Exception:
            pass
    return set(targets)


def _issue_credit_with_verification(
    dmapi,
    selection: CreditDrainSelection,
    blocked_sign_up_ids: set[str],
    retry_attempts: int,
) -> tuple[tuple[DrainRecord, ...], tuple[DrainRecord, ...]]:
    remaining = [
        member
        for member in sorted(selection.selected_members, key=lambda item: item.sign_up_id)
        if member.sign_up_id not in blocked_sign_up_ids and member.user_id
    ]
    successes: list[DrainRecord] = []
    seen_successes: set[str] = set()

    for member in selection.selected_members:
        if member.sign_up_id in blocked_sign_up_ids:
            continue
        if not member.user_id:
            blocked_sign_up_ids.add(member.sign_up_id)

    for _ in range(max(1, retry_attempts)):
        if not remaining:
            break
        user_list = ",".join(member.user_id for member in remaining)
        try:
            dmapi.send_credit(selection.activity_id, selection.credit_id, user_list)
        except Exception:
            pass

        credited_after = _credited_sign_up_ids(
            dmapi,
            selection.activity_id,
            selection.credit_id,
            retry_attempts,
        )
        current_successes = [
            member
            for member in remaining
            if member.sign_up_id in credited_after
            and member.sign_up_id not in seen_successes
        ]
        for member in current_successes:
            successes.append(
                _record(selection, member, note="Credit issued successfully")
            )
            seen_successes.add(member.sign_up_id)
        remaining = [
            member
            for member in remaining
            if member.sign_up_id not in credited_after
        ]

    failures = [
        _record(selection, member, note="Credit issue failed after retries")
        for member in remaining
    ]
    failures.extend(
        _record(selection, member, note="Resign failed before credit issue")
        for member in selection.selected_members
        if member.sign_up_id in blocked_sign_up_ids
    )
    return tuple(successes), tuple(failures)


def _execute_activity_batch(
    dmapi,
    batch: ActivityDrainBatch,
    retry_attempts: int,
) -> tuple[tuple[DrainRecord, ...], tuple[DrainRecord, ...]]:
    member_by_sign_up_id: dict[str, CandidateMember] = {}
    for selection in batch.selections:
        for member in selection.selected_members:
            member_by_sign_up_id.setdefault(member.sign_up_id, member)

    blocked_sign_up_ids = _resign_activity_members(
        dmapi,
        batch.activity_id,
        tuple(member_by_sign_up_id[key] for key in sorted(member_by_sign_up_id)),
        retry_attempts,
    )

    successes: list[DrainRecord] = []
    failures: list[DrainRecord] = []
    for selection in batch.selections:
        selection_successes, selection_failures = _issue_credit_with_verification(
            dmapi,
            selection,
            set(blocked_sign_up_ids),
            retry_attempts,
        )
        successes.extend(selection_successes)
        failures.extend(selection_failures)
    return tuple(successes), tuple(failures)


def _make_batch_dir(output_dir) -> Path:
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S_%f")
    batch_dir = Path(output_dir) / timestamp
    batch_dir.mkdir(parents=True, exist_ok=True)
    return batch_dir


def _print_activity_summary(print_func, batch: ActivityDrainBatch) -> None:
    lines = [
        f"活动 {batch.activity_id} {batch.activity_name}",
        f"本活动合计将发放 {batch.planned_issue_count} 人次。",
    ]
    for selection in batch.selections:
        lines.append(
            "  "
            f"{selection.credit_type or '无学分项'} "
            f"creditId={selection.credit_id or '-'} "
            f"已发={selection.provided_count} "
            f"阈值={selection.final_target_count if selection.final_target_count is not None else selection.threshold} "
            f"百分比={selection.threshold_percent if selection.threshold_percent is not None else '-'} "
            f"偏移={selection.jitter_offset} "
            f"候选={selection.candidate_count} "
            f"本次={selection.planned_issue_count} "
            f"状态={selection.status}"
        )
    print_func("\n".join(lines))


def run_random_drain_workflow(
    dmapi,
    threshold_percent: int,
    output_dir,
    seed: int | None = None,
    jitter_count: int = 0,
    retry_attempts: int = 3,
    input_func=input,
    print_func=print,
) -> RandomDrainResult:
    _validate_target_options(threshold_percent, jitter_count)

    batch_dir = _make_batch_dir(output_dir)
    batches = build_random_drain_batches(
        dmapi,
        threshold_percent=threshold_percent,
        jitter_count=jitter_count,
        rng=Random(seed),
        retry_attempts=retry_attempts,
    )
    selections = tuple(
        selection
        for batch in batches
        for selection in batch.selections
    )

    successes: list[DrainRecord] = []
    failures: list[DrainRecord] = []
    skipped: list[DrainRecord] = list(_selection_skip_records(selections))

    for batch in batches:
        if batch.planned_issue_count <= 0:
            continue
        _print_activity_summary(print_func, batch)
        confirmation = input_func(f"输入 EXECUTE {batch.activity_id} 确认发放该活动：")
        if confirmation != f"EXECUTE {batch.activity_id}":
            skipped.extend(_activity_unconfirmed_records(batch))
            continue

        batch_successes, batch_failures = _execute_activity_batch(
            dmapi,
            batch,
            retry_attempts,
        )
        successes.extend(batch_successes)
        failures.extend(batch_failures)

    result = RandomDrainResult(
        batch_dir=batch_dir,
        selections=selections,
        successes=tuple(successes),
        failures=tuple(failures),
        skipped=tuple(skipped),
    )
    write_random_drain_reports(
        batch_dir,
        selections=result.selections,
        successes=result.successes,
        failures=result.failures,
        skipped=result.skipped,
    )
    return result
