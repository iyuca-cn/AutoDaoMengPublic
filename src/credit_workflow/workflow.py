from __future__ import annotations

import json
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from pathlib import Path

from .activity_catalog import build_activity_bundles
from .eligibility import EligibilityResult, build_eligibility_map
from .input_excel import PriorityDemandRecord, load_and_aggregate_priority_demands
from .models import ActivityBundle, DemandRecord
from .planner import (
    BundleCandidate,
    DemandAllocation,
    Planner,
    PlannableDemand,
    PlanningResult,
)
from .reports import write_plan_reports

RECOVERABLE_PREVIEW_READ_EXCEPTIONS = (RuntimeError, OSError)
UNSAFE_BATCH_LABEL_CHARS = set('<>:"/\\|?*')


@dataclass(frozen=True, slots=True)
class PlanWorkflowResult:
    batch_dir: Path
    plan_payload: dict


def _bundle_lookup(
    bundles: tuple[ActivityBundle, ...],
) -> dict[tuple[str, str], tuple[ActivityBundle, ...]]:
    grouped: dict[tuple[str, str], list[ActivityBundle]] = {}
    for bundle in bundles:
        key = (bundle.activity_id, bundle.credit_type)
        grouped.setdefault(key, []).append(bundle)
    return {key: tuple(values) for key, values in grouped.items()}


def _build_plannable_demands(
    demands: tuple[DemandRecord, ...],
    bundles: tuple[ActivityBundle, ...],
    eligibility: EligibilityResult,
) -> tuple[PlannableDemand, ...]:
    bundles_by_key = _bundle_lookup(bundles)
    plannable_demands = []
    for demand in demands:
        candidates = []
        for match in eligibility.matches_for_demand(demand):
            matched_bundles = bundles_by_key.get((match.activity_id, match.credit_type))
            if not matched_bundles:
                continue
            for bundle in matched_bundles:
                candidates.append(
                    BundleCandidate(
                        bundle=bundle,
                        sign_up_id=match.sign_up_id,
                        user_id=match.user_id,
                    )
                )
        plannable_demands.append(
            PlannableDemand(demand=demand, candidates=tuple(candidates))
        )
    return tuple(plannable_demands)


def _build_plannable_demand(
    demand: DemandRecord,
    bundles: tuple[ActivityBundle, ...],
    eligibility: EligibilityResult,
) -> PlannableDemand:
    return _build_plannable_demands((demand,), bundles, eligibility)[0]


def _priority_type_demands(
    priority_demands: tuple[PriorityDemandRecord, ...],
) -> tuple[DemandRecord, ...]:
    demands: dict[tuple[str, str, str], DemandRecord] = {}
    for priority_demand in priority_demands:
        for credit_type in priority_demand.credit_types:
            key = (
                priority_demand.student_id,
                priority_demand.student_name,
                credit_type,
            )
            demands.setdefault(
                key,
                DemandRecord(
                    student_id=priority_demand.student_id,
                    student_name=priority_demand.student_name,
                    credit_type=credit_type,
                    requested_value_cent=priority_demand.requested_value_cent,
                ),
            )
    return tuple(demands.values())


def _aggregate_demands(demands: tuple[DemandRecord, ...]) -> tuple[DemandRecord, ...]:
    requested_by_key: dict[tuple[str, str, str], int] = {}
    for demand in demands:
        key = (demand.student_id, demand.student_name, demand.credit_type)
        requested_by_key[key] = requested_by_key.get(key, 0) + demand.requested_value_cent

    return tuple(
        DemandRecord(
            student_id=student_id,
            student_name=student_name,
            credit_type=credit_type,
            requested_value_cent=requested_value_cent,
        )
        for (
            student_id,
            student_name,
            credit_type,
        ), requested_value_cent in requested_by_key.items()
    )


def _retarget_allocation(
    allocation: DemandAllocation,
    requested_value_cent: int,
) -> DemandAllocation:
    demand = replace(
        allocation.demand,
        requested_value_cent=requested_value_cent,
    )
    return DemandAllocation(
        demand=demand,
        assignments=allocation.assignments,
        planned_value_cent=allocation.planned_value_cent,
        delta_cent=allocation.planned_value_cent - requested_value_cent,
    )


def _zero_allocation(demand: DemandRecord) -> DemandAllocation:
    return DemandAllocation(
        demand=demand,
        assignments=(),
        planned_value_cent=0,
        delta_cent=-demand.requested_value_cent,
    )


def _plan_priority_demands(
    priority_demands: tuple[PriorityDemandRecord, ...],
    bundles: tuple[ActivityBundle, ...],
    eligibility: EligibilityResult,
) -> tuple[tuple[DemandRecord, ...], PlanningResult, EligibilityResult]:
    remaining_by_index = {
        index: demand.requested_value_cent
        for index, demand in enumerate(priority_demands)
    }
    allocations: list[DemandAllocation] = []
    not_in_admit_demands: list[DemandRecord] = []
    assignment_counts: dict[str, int] = {}
    max_priority_count = max(
        (len(demand.credit_types) for demand in priority_demands),
        default=0,
    )

    for priority_index in range(max_priority_count):
        layer_entries: list[tuple[int, bool, PlannableDemand]] = []

        for demand_index, priority_demand in enumerate(priority_demands):
            remaining_value_cent = remaining_by_index.get(demand_index, 0)
            if remaining_value_cent <= 0:
                continue
            if priority_index >= len(priority_demand.credit_types):
                continue

            has_later_type = priority_index + 1 < len(priority_demand.credit_types)
            demand = DemandRecord(
                student_id=priority_demand.student_id,
                student_name=priority_demand.student_name,
                credit_type=priority_demand.credit_types[priority_index],
                requested_value_cent=remaining_value_cent,
            )
            plannable_demand = _build_plannable_demand(demand, bundles, eligibility)
            if not plannable_demand.candidates:
                if not has_later_type:
                    allocations.append(_zero_allocation(demand))
                    not_in_admit_demands.append(demand)
                    remaining_by_index[demand_index] = 0
                continue

            layer_entries.append((demand_index, has_later_type, plannable_demand))

        if not layer_entries:
            continue

        layer_result = Planner(assignment_counts).plan(
            tuple(entry[2] for entry in layer_entries)
        )
        assignment_counts = layer_result.bundle_assignment_counts

        for (demand_index, has_later_type, _), allocation in zip(
            layer_entries,
            layer_result.allocations,
        ):
            remaining_value_cent = remaining_by_index.get(demand_index, 0)
            if remaining_value_cent <= 0:
                continue

            planned_value_cent = allocation.planned_value_cent
            if planned_value_cent <= 0:
                if not has_later_type:
                    allocations.append(_retarget_allocation(allocation, remaining_value_cent))
                    remaining_by_index[demand_index] = 0
                continue

            next_remaining_value_cent = max(
                0,
                remaining_value_cent - planned_value_cent,
            )
            segment_requested_value_cent = (
                planned_value_cent
                if next_remaining_value_cent > 0 and has_later_type
                else remaining_value_cent
            )
            allocations.append(
                _retarget_allocation(allocation, segment_requested_value_cent)
            )
            remaining_by_index[demand_index] = (
                next_remaining_value_cent if has_later_type else 0
            )

    effective_demands = _aggregate_demands(
        tuple(allocation.demand for allocation in allocations)
    )
    report_eligibility = EligibilityResult(
        matches_by_demand=eligibility.matches_by_demand,
        not_in_admit_list=tuple(not_in_admit_demands),
    )
    return (
        effective_demands,
        PlanningResult(
            allocations=tuple(allocations),
            bundle_assignment_counts=assignment_counts,
        ),
        report_eligibility,
    )


def _serialize_bundles(bundles: tuple[ActivityBundle, ...]) -> list[dict]:
    return [asdict(bundle) for bundle in bundles]


def _serialize_allocations(planning_result: PlanningResult) -> list[dict]:
    payload = []
    for allocation in planning_result.allocations:
        payload.append(
            {
                "demand": asdict(allocation.demand),
                "planned_value_cent": allocation.planned_value_cent,
                "delta_cent": allocation.delta_cent,
                "assignments": [
                    {
                        "bundle": asdict(assignment.bundle),
                        "sign_up_id": assignment.sign_up_id,
                        "user_id": assignment.user_id,
                    }
                    for assignment in allocation.assignments
                ],
            }
        )
    return payload


def _serialize_demands(demands: tuple[DemandRecord, ...]) -> list[dict]:
    return [asdict(demand) for demand in demands]


def _credited_sign_up_ids_with_retry(
    dmapi,
    activity_id: str,
    credit_id: str,
    retry_attempts: int,
) -> set[str]:
    last_error: Exception | None = None
    for _ in range(max(1, retry_attempts)):
        try:
            credited = dmapi.get_credit_list(
                dmapi.CREDIT_URL_CREDITEDMEM, activity_id, credit_id
            )
        except RECOVERABLE_PREVIEW_READ_EXCEPTIONS as exc:
            last_error = exc
            continue

        if credited is None:
            last_error = RuntimeError(
                f"Failed to fetch credited members for {activity_id}:{credit_id}"
            )
            continue

        return {str(user["signUpId"]) for user in credited}

    if last_error is not None:
        raise last_error
    return set()


def _collect_preissued_preview(
    dmapi,
    planning_result: PlanningResult,
    retry_attempts: int = 3,
) -> dict[str, tuple[dict, ...]]:
    credited_cache: dict[tuple[str, str], set[str]] = {}
    partial: list[dict] = []
    full: list[dict] = []

    for allocation in planning_result.allocations:
        grouped_assignments: dict[
            tuple[str, str, str, str],
            dict[str, object],
        ] = {}
        for assignment in allocation.assignments:
            group_key = (
                assignment.bundle.activity_id,
                assignment.bundle.activity_name,
                assignment.bundle.credit_type,
                assignment.sign_up_id,
            )
            group = grouped_assignments.setdefault(
                group_key,
                {
                    "activity_id": assignment.bundle.activity_id,
                    "activity_name": assignment.bundle.activity_name,
                    "credit_type": assignment.bundle.credit_type,
                    "student_id": allocation.demand.student_id,
                    "student_name": allocation.demand.student_name,
                    "sign_up_id": assignment.sign_up_id,
                    "credit_items": {},
                },
            )
            credit_items = group["credit_items"]
            for credit_item in assignment.bundle.credit_items:
                credit_items[credit_item.credit_id] = credit_item

        for group in grouped_assignments.values():
            credited_count = 0
            credit_items = tuple(group["credit_items"].values())
            total_items = len(credit_items)
            for credit_item in credit_items:
                cache_key = (str(group["activity_id"]), credit_item.credit_id)
                if cache_key not in credited_cache:
                    credited_cache[cache_key] = _credited_sign_up_ids_with_retry(
                        dmapi,
                        str(group["activity_id"]),
                        credit_item.credit_id,
                        retry_attempts,
                    )
                if str(group["sign_up_id"]) in credited_cache[cache_key]:
                    credited_count += 1

            if credited_count == 0:
                continue

            record = {
                "activity_id": str(group["activity_id"]),
                "activity_name": str(group["activity_name"]),
                "credit_type": str(group["credit_type"]),
                "student_id": str(group["student_id"]),
                "student_name": str(group["student_name"]),
                "note": (
                    "All bundle credits were already issued"
                    if credited_count == total_items
                    else "Some bundle credits were already issued"
                ),
            }
            if credited_count == total_items:
                full.append(record)
            else:
                partial.append(record)

    return {
        "already_partially_issued": tuple(partial),
        "already_fully_issued": tuple(full),
    }


def _build_plan_payload(
    demands: tuple[DemandRecord, ...],
    bundles: tuple[ActivityBundle, ...],
    eligibility: EligibilityResult,
    planning_result: PlanningResult,
) -> dict:
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "demands": _serialize_demands(demands),
        "bundles": _serialize_bundles(bundles),
        "allocations": _serialize_allocations(planning_result),
        "bundle_assignment_counts": planning_result.bundle_assignment_counts,
        "not_in_admit_list": _serialize_demands(eligibility.not_in_admit_list),
    }


def _safe_batch_label_prefix(excel_path) -> str:
    stem = Path(excel_path).stem.strip()
    safe_stem = "".join(
        "_" if ch in UNSAFE_BATCH_LABEL_CHARS or ord(ch) < 32 else ch
        for ch in stem
    ).strip(" ._")
    return safe_stem or "plan"


def _make_batch_dir(
    output_dir: Path,
    batch_label: str | None = None,
    excel_path=None,
) -> Path:
    if batch_label is None:
        timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
        if excel_path is None:
            batch_label = timestamp
        else:
            batch_label = f"{_safe_batch_label_prefix(excel_path)}_{timestamp}"
    batch_dir = output_dir / batch_label
    batch_dir.mkdir(parents=True, exist_ok=True)
    return batch_dir


def run_plan_workflow(
    dmapi,
    excel_path,
    output_dir,
    batch_label: str | None = None,
    retry_attempts: int = 3,
) -> PlanWorkflowResult:
    priority_demands = tuple(load_and_aggregate_priority_demands(excel_path))
    bundles = tuple(build_activity_bundles(dmapi, retry_attempts=retry_attempts))
    eligibility_demands = _priority_type_demands(priority_demands)
    eligibility = build_eligibility_map(dmapi, list(bundles), list(eligibility_demands))
    demands, planning_result, report_eligibility = _plan_priority_demands(
        priority_demands,
        bundles,
        eligibility,
    )
    preissued_preview = _collect_preissued_preview(
        dmapi,
        planning_result,
        retry_attempts=retry_attempts,
    )

    batch_dir = _make_batch_dir(Path(output_dir), batch_label, excel_path)
    write_plan_reports(
        batch_dir,
        demands,
        bundles,
        report_eligibility,
        planning_result,
        preissued_preview,
    )

    plan_payload = _build_plan_payload(demands, bundles, report_eligibility, planning_result)
    (batch_dir / "plan.json").write_text(
        json.dumps(plan_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return PlanWorkflowResult(batch_dir=batch_dir, plan_payload=plan_payload)
