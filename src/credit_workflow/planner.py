from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from .models import ActivityBundle, DemandRecord


@dataclass(frozen=True, slots=True)
class BundleCandidate:
    bundle: ActivityBundle
    sign_up_id: str
    user_id: str


@dataclass(frozen=True, slots=True)
class PlannableDemand:
    demand: DemandRecord
    candidates: tuple[BundleCandidate, ...]


@dataclass(frozen=True, slots=True)
class DemandAllocation:
    demand: DemandRecord
    assignments: tuple[BundleCandidate, ...]
    planned_value_cent: int
    delta_cent: int


@dataclass(frozen=True, slots=True)
class PlanningResult:
    allocations: tuple[DemandAllocation, ...]
    bundle_assignment_counts: dict[str, int]


def bundle_key(bundle: ActivityBundle) -> str:
    credit_ids = ",".join(sorted(item.credit_id for item in bundle.credit_items))
    return f"{bundle.activity_id}:{bundle.credit_type}:{credit_ids}"


def _candidate_balance_key(
    assignments: tuple[BundleCandidate, ...],
    usage_counts: dict[str, int],
) -> tuple[float, float, int, tuple[str, ...]]:
    post_usage_rates = []
    keys = []
    for assignment in assignments:
        key = bundle_key(assignment.bundle)
        keys.append(key)
        post_usage_rates.append(
            (usage_counts.get(key, 0) + 1) / assignment.bundle.bundle_capacity
        )

    return (
        sum(rate * rate for rate in post_usage_rates),
        max(post_usage_rates, default=0.0),
        len(assignments),
        tuple(sorted(keys)),
    )


def _choose_best_assignments(
    target_value_cent: int,
    candidates: tuple[BundleCandidate, ...],
    usage_counts: dict[str, int],
    *,
    prefer_overflow: bool,
) -> tuple[BundleCandidate, ...]:
    if not candidates:
        return ()

    max_bundle_value = max(candidate.bundle.bundle_value_cent for candidate in candidates)
    total_limit = target_value_cent + max_bundle_value

    states: dict[int, tuple[BundleCandidate, ...]] = {0: ()}
    for candidate in candidates:
        next_states = dict(states)
        for total, assignments in sorted(states.items(), reverse=True):
            next_total = total + candidate.bundle.bundle_value_cent
            if next_total > total_limit:
                continue

            next_assignments = assignments + (candidate,)
            existing = next_states.get(next_total)
            if existing is None or _candidate_balance_key(
                next_assignments, usage_counts
            ) < _candidate_balance_key(existing, usage_counts):
                next_states[next_total] = next_assignments

        states = next_states

    totals = [total for total in states if total > 0]
    if not totals:
        return ()

    exact_totals = [total for total in totals if total == target_value_cent]
    if exact_totals:
        exact_total = exact_totals[0]
        return states[exact_total]

    if prefer_overflow:
        overflow_totals = [total for total in totals if total > target_value_cent]
        if overflow_totals:
            best_total = min(overflow_totals)
            return states[best_total]
    else:
        shortage_totals = [total for total in totals if total < target_value_cent]
        if shortage_totals:
            best_total = max(shortage_totals)
            return states[best_total]
        return ()

    best_total = max(totals)
    return states[best_total]


def plan_student_allocation(
    demand: DemandRecord,
    candidates: tuple[BundleCandidate, ...],
    usage_counts: dict[str, int],
    *,
    prefer_overflow: bool = True,
) -> DemandAllocation:
    available_candidates = tuple(
        candidate
        for candidate in candidates
        if usage_counts.get(bundle_key(candidate.bundle), 0) < candidate.bundle.bundle_capacity
    )
    assignments = _choose_best_assignments(
        demand.requested_value_cent,
        available_candidates,
        usage_counts,
        prefer_overflow=prefer_overflow,
    )
    planned_value_cent = sum(
        assignment.bundle.bundle_value_cent for assignment in assignments
    )

    return DemandAllocation(
        demand=demand,
        assignments=assignments,
        planned_value_cent=planned_value_cent,
        delta_cent=planned_value_cent - demand.requested_value_cent,
    )


class Planner:
    def __init__(self, bundle_assignment_counts: dict[str, int] | None = None):
        self.bundle_assignment_counts = dict(bundle_assignment_counts or {})

    def _sort_key(
        self,
        plannable_demand: PlannableDemand,
        original_index: int,
    ) -> tuple[int, int, int, int]:
        available_candidates = [
            candidate
            for candidate in plannable_demand.candidates
            if self.bundle_assignment_counts.get(bundle_key(candidate.bundle), 0)
            < candidate.bundle.bundle_capacity
        ]
        reachable_total = sum(
            candidate.bundle.bundle_value_cent for candidate in available_candidates
        )
        return (
            len(available_candidates),
            reachable_total,
            -plannable_demand.demand.requested_value_cent,
            original_index,
        )

    @staticmethod
    def _apply_assignment_counts_delta(
        assignment_counts: dict[str, int],
        assignments: tuple[BundleCandidate, ...],
        delta: int,
    ) -> None:
        for assignment in assignments:
            key = bundle_key(assignment.bundle)
            assignment_counts[key] = assignment_counts.get(key, 0) + delta

    @staticmethod
    def _incremental_upgrade_cost(
        current_assignments: tuple[BundleCandidate, ...],
        upgraded_assignments: tuple[BundleCandidate, ...],
    ) -> int:
        current_counts: dict[str, int] = defaultdict(int)
        upgraded_counts: dict[str, int] = defaultdict(int)
        for assignment in current_assignments:
            current_counts[bundle_key(assignment.bundle)] += 1
        for assignment in upgraded_assignments:
            upgraded_counts[bundle_key(assignment.bundle)] += 1

        all_keys = set(current_counts) | set(upgraded_counts)
        return sum(
            max(0, upgraded_counts.get(key, 0) - current_counts.get(key, 0))
            for key in all_keys
        )

    def _upgrade_shortages_with_remaining_capacity(
        self,
        plannable_demands: tuple[PlannableDemand, ...],
        ordered_indices: list[int],
        allocations_by_index: dict[int, DemandAllocation],
        assignment_counts: defaultdict[str, int],
    ) -> None:
        pending = [
            index
            for index in ordered_indices
            if allocations_by_index[index].delta_cent < 0
        ]

        while pending:
            upgrade_options: list[
                tuple[
                    tuple[object, ...],
                    int,
                    DemandAllocation,
                    tuple[BundleCandidate, ...],
                ]
            ] = []

            for index in pending:
                allocation = allocations_by_index[index]
                if allocation.delta_cent >= 0:
                    continue

                demand = plannable_demands[index].demand
                current_assignments = allocation.assignments
                temp_counts = defaultdict(int, assignment_counts)
                self._apply_assignment_counts_delta(
                    temp_counts,
                    current_assignments,
                    delta=-1,
                )

                upgraded = plan_student_allocation(
                    demand,
                    plannable_demands[index].candidates,
                    temp_counts,
                    prefer_overflow=True,
                )
                if upgraded.planned_value_cent < demand.requested_value_cent:
                    continue

                if upgraded.assignments == current_assignments:
                    continue

                incremental_cost = self._incremental_upgrade_cost(
                    current_assignments,
                    upgraded.assignments,
                )
                option_key = (
                    incremental_cost,
                    upgraded.delta_cent,
                    len(upgraded.assignments),
                    _candidate_balance_key(upgraded.assignments, temp_counts),
                    index,
                )
                upgrade_options.append(
                    (
                        option_key,
                        index,
                        upgraded,
                        current_assignments,
                    )
                )

            if not upgrade_options:
                break

            _, selected_index, selected_upgrade, selected_current = min(
                upgrade_options, key=lambda item: item[0]
            )
            self._apply_assignment_counts_delta(
                assignment_counts,
                selected_current,
                delta=-1,
            )
            self._apply_assignment_counts_delta(
                assignment_counts,
                selected_upgrade.assignments,
                delta=1,
            )
            allocations_by_index[selected_index] = selected_upgrade
            pending = [
                index
                for index in pending
                if allocations_by_index[index].delta_cent < 0
            ]

    def plan(self, plannable_demands: tuple[PlannableDemand, ...]) -> PlanningResult:
        allocations_by_index: dict[int, DemandAllocation] = {}
        assignment_counts = defaultdict(int, self.bundle_assignment_counts)

        grouped_indices: dict[str, list[int]] = defaultdict(list)
        for index, plannable_demand in enumerate(plannable_demands):
            grouped_indices[plannable_demand.demand.credit_type].append(index)

        for credit_type in sorted(grouped_indices):
            ordered_indices = sorted(
                grouped_indices[credit_type],
                key=lambda index: self._sort_key(plannable_demands[index], index),
            )
            for index in ordered_indices:
                allocation = plan_student_allocation(
                    plannable_demands[index].demand,
                    plannable_demands[index].candidates,
                    assignment_counts,
                    prefer_overflow=False,
                )
                allocations_by_index[index] = allocation
                for assignment in allocation.assignments:
                    assignment_counts[bundle_key(assignment.bundle)] += 1

            self._upgrade_shortages_with_remaining_capacity(
                plannable_demands,
                ordered_indices,
                allocations_by_index,
                assignment_counts,
            )

        allocations = tuple(
            allocations_by_index[index] for index in range(len(plannable_demands))
        )
        return PlanningResult(
            allocations=allocations,
            bundle_assignment_counts=dict(assignment_counts),
        )
