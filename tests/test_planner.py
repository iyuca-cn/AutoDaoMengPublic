from credit_workflow.models import ActivityBundle, CreditItem, DemandRecord
from credit_workflow.planner import (
    BundleCandidate,
    Planner,
    PlannableDemand,
    bundle_key,
    plan_student_allocation,
)


def make_bundle(
    activity_id: str,
    value_cent: int,
    capacity: int = 10,
    credit_type: str = "美育实践学分",
    credit_id: str | None = None,
) -> ActivityBundle:
    item_credit_id = credit_id or f"{activity_id}-{value_cent}"
    return ActivityBundle(
        activity_id=activity_id,
        activity_name=f"活动{activity_id}",
        credit_type=credit_type,
        bundle_value_cent=value_cent,
        bundle_capacity=capacity,
        credit_items=(
            CreditItem(
                credit_id=item_credit_id,
                score_id=f"{activity_id}-score",
                credit_type=credit_type,
                unitcount_cent=value_cent,
                remaining_capacity=capacity,
            ),
        ),
    )


def make_candidate(
    activity_id: str,
    value_cent: int,
    capacity: int = 10,
    sign_up_id: str | None = None,
    user_id: str | None = None,
    credit_id: str | None = None,
) -> BundleCandidate:
    bundle = make_bundle(activity_id, value_cent, capacity, credit_id=credit_id)
    return BundleCandidate(
        bundle=bundle,
        sign_up_id=sign_up_id or f"signup-{activity_id}",
        user_id=user_id or f"user-{activity_id}",
    )


def test_exact_match_beats_overflow():
    demand = DemandRecord("20250001", "张三", "美育实践学分", 50)
    candidates = (
        make_candidate("A", 20),
        make_candidate("B", 30),
        make_candidate("C", 50),
    )

    allocation = plan_student_allocation(demand, candidates, {})

    assert [assignment.bundle.activity_id for assignment in allocation.assignments] == ["C"]
    assert allocation.planned_value_cent == 50
    assert allocation.delta_cent == 0


def test_overflow_beats_shortage():
    demand = DemandRecord("20250001", "张三", "美育实践学分", 40)
    candidates = (
        make_candidate("A", 50),
        make_candidate("B", 20),
    )

    allocation = plan_student_allocation(demand, candidates, {})

    assert [assignment.bundle.activity_id for assignment in allocation.assignments] == ["A"]
    assert allocation.planned_value_cent == 50
    assert allocation.delta_cent == 10


def test_conservative_mode_prefers_shortage_over_overflow():
    demand = DemandRecord("20250001", "张三", "美育实践学分", 40)
    candidates = (
        make_candidate("A", 50),
        make_candidate("B", 30),
    )

    allocation = plan_student_allocation(
        demand,
        candidates,
        {},
        prefer_overflow=False,
    )

    assert [assignment.bundle.activity_id for assignment in allocation.assignments] == ["B"]
    assert allocation.planned_value_cent == 30
    assert allocation.delta_cent == -10


def test_same_activity_split_credit_rows_support_exact_single_item_match():
    demand = DemandRecord("20250001", "张三", "美育实践学分", 20)
    candidates = (
        make_candidate("A", 20, credit_id="A-201"),
        make_candidate("A", 30, credit_id="A-202"),
    )

    allocation = plan_student_allocation(demand, candidates, {})

    assert [assignment.bundle.bundle_value_cent for assignment in allocation.assignments] == [20]
    assert [item.credit_id for item in allocation.assignments[0].bundle.credit_items] == ["A-201"]
    assert allocation.planned_value_cent == 20
    assert allocation.delta_cent == 0


def test_equal_issue_grade_prefers_lower_usage_concentration():
    demand = DemandRecord("20250001", "张三", "美育实践学分", 50)
    candidate_a = make_candidate("A", 50, capacity=10)
    candidate_b = make_candidate("B", 50, capacity=10)
    usage_counts = {
        bundle_key(candidate_a.bundle): 8,
        bundle_key(candidate_b.bundle): 2,
    }

    allocation = plan_student_allocation(demand, (candidate_a, candidate_b), usage_counts)

    assert [assignment.bundle.activity_id for assignment in allocation.assignments] == ["B"]


def test_planner_orders_demands_by_scarcity_and_reserves_capacity():
    scarce_bundle = make_candidate("A", 50, capacity=1)
    shared_bundle = make_candidate("B", 50, capacity=1)
    less_scarce = PlannableDemand(
        demand=DemandRecord("20250001", "张三", "美育实践学分", 100),
        candidates=(scarce_bundle, shared_bundle),
    )
    more_scarce = PlannableDemand(
        demand=DemandRecord("20250002", "李四", "美育实践学分", 50),
        candidates=(shared_bundle,),
    )

    result = Planner().plan((less_scarce, more_scarce))
    allocations_by_student = {
        allocation.demand.student_id: allocation for allocation in result.allocations
    }

    assert allocations_by_student["20250002"].planned_value_cent == 50
    assert allocations_by_student["20250002"].delta_cent == 0
    assert [assignment.bundle.activity_id for assignment in allocations_by_student["20250002"].assignments] == ["B"]

    assert allocations_by_student["20250001"].planned_value_cent == 50
    assert allocations_by_student["20250001"].delta_cent == -50
    assert [assignment.bundle.activity_id for assignment in allocations_by_student["20250001"].assignments] == ["A"]

    assert result.bundle_assignment_counts[bundle_key(shared_bundle.bundle)] == 1
    assert result.bundle_assignment_counts[bundle_key(scarce_bundle.bundle)] == 1


def test_planner_upgrades_shortages_with_minimal_overflow_using_remaining_capacity():
    low_bundle = make_candidate("A", 30, capacity=2)
    high_bundle = make_candidate("B", 50, capacity=1)

    demand_1 = PlannableDemand(
        demand=DemandRecord("20250001", "张三", "美育实践学分", 40),
        candidates=(low_bundle, high_bundle),
    )
    demand_2 = PlannableDemand(
        demand=DemandRecord("20250002", "李四", "美育实践学分", 40),
        candidates=(low_bundle, high_bundle),
    )

    result = Planner().plan((demand_1, demand_2))
    allocations = sorted(
        result.allocations,
        key=lambda allocation: allocation.demand.student_id,
    )

    planned_values = sorted(allocation.planned_value_cent for allocation in allocations)
    assert planned_values == [30, 50]

    overflow_allocation = next(
        allocation for allocation in allocations if allocation.planned_value_cent == 50
    )
    assert overflow_allocation.delta_cent == 10
    assert [assignment.bundle.bundle_value_cent for assignment in overflow_allocation.assignments] == [
        50
    ]
