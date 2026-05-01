from random import Random

from random_drain.models import CandidateMember, CreditDrainSelection
from random_drain.workflow import (
    build_random_drain_batches,
    calculate_target_count,
    run_random_drain_workflow,
)


def test_calculates_percent_target_with_half_up_rounding():
    assert calculate_target_count(200, 90, 0) == 180
    assert calculate_target_count(100, 90, 0) == 90
    assert calculate_target_count(101, 50, 0) == 51
    assert calculate_target_count(101, 90, 0) == 91


def test_calculates_percent_target_with_jitter_and_clamping():
    assert calculate_target_count(100, 90, -5) == 85
    assert calculate_target_count(100, 90, 5) == 95
    assert calculate_target_count(100, 99, 5) == 100
    assert calculate_target_count(100, 1, -5) == 0


def test_random_drain_models_are_importable():
    member = CandidateMember(sign_up_id="9001", user_id="u-001", name="张三")

    selection = CreditDrainSelection(
        activity_id="1001",
        activity_name="活动A",
        credit_id="201",
        credit_type="美育实践学分",
        total_capacity=100,
        provided_count=70,
        threshold=90,
        selected_members=(member,),
        candidate_count=1,
        status="ready",
        note="",
    )

    assert selection.planned_issue_count == 1


class FakeDrainDMAPI:
    CREDIT_URL_CANDIDATES = "candidates"
    CREDIT_URL_OTHERMEMS = "othermems"
    CREDIT_URL_CREDITEDMEM = "credited"

    def __init__(self):
        self.sign_ids = {"1001": "sign-1001"}

    def get_mime_manage_activity_dict(self):
        return {"1001": {"activityId": 1001, "name": "活动A"}}

    def get_signid(self, activity_id):
        return self.sign_ids.get(str(activity_id))

    def get_creditType_list(self, activity_id):
        assert str(activity_id) == "1001"
        return [
            {
                "creditId": "201",
                "scoreId": "301",
                "scorename": "美育实践学分",
                "unitcount": "0.50",
                "num": 100,
                "providenum": 70,
            }
        ]

    def get_credit_list(self, url, activity_id, credit_id):
        rows = {
            self.CREDIT_URL_CREDITEDMEM: [
                {"signUpId": "already", "userId": "u-already", "name": "已发"}
            ],
            self.CREDIT_URL_CANDIDATES: [
                {"signUpId": "9001", "userId": "u-001", "name": "张三"},
                {"signUpId": "9002", "userId": "u-002", "name": "李四"},
            ],
            self.CREDIT_URL_OTHERMEMS: [
                {"signUpId": "9003", "userId": "u-003", "name": "王五"},
                {"signUpId": "9001", "userId": "u-001", "name": "张三"},
            ],
        }
        return rows[url]


def test_builds_random_selection_from_uncredited_candidates():
    batches = build_random_drain_batches(
        FakeDrainDMAPI(),
        threshold_percent=72,
        jitter_count=0,
        rng=Random(1),
    )

    assert len(batches) == 1
    selection = batches[0].selections[0]
    assert selection.activity_id == "1001"
    assert selection.credit_id == "201"
    assert selection.provided_count == 70
    assert selection.threshold == 72
    assert selection.threshold_percent == 72
    assert selection.base_target_count == 72
    assert selection.jitter_offset == 0
    assert selection.final_target_count == 72
    assert selection.planned_issue_count == 2
    assert selection.candidate_count == 3
    assert selection.status == "ready"
    assert {member.sign_up_id for member in selection.selected_members} == {
        "9002",
        "9003",
    }


def test_skips_credit_row_that_already_reached_threshold():
    class ThresholdReachedDMAPI(FakeDrainDMAPI):
        def get_creditType_list(self, activity_id):
            return [
                {
                    "creditId": "201",
                    "scoreId": "301",
                    "scorename": "美育实践学分",
                    "unitcount": "0.50",
                    "num": 100,
                    "providenum": 90,
                }
            ]

    batches = build_random_drain_batches(
        ThresholdReachedDMAPI(),
        threshold_percent=90,
        jitter_count=0,
        rng=Random(1),
    )

    selection = batches[0].selections[0]
    assert selection.planned_issue_count == 0
    assert selection.status == "threshold_reached"


def test_marks_candidate_shortage_when_candidates_are_not_enough():
    batches = build_random_drain_batches(
        FakeDrainDMAPI(),
        threshold_percent=80,
        jitter_count=0,
        rng=Random(1),
    )

    selection = batches[0].selections[0]
    assert selection.planned_issue_count == 3
    assert selection.status == "candidate_shortage"
    assert "候选不足" in selection.note


class JitterDrainDMAPI(FakeDrainDMAPI):
    def get_creditType_list(self, activity_id):
        return [
            {
                "creditId": "201",
                "scoreId": "301",
                "scorename": "美育实践学分",
                "unitcount": "0.50",
                "num": 100,
                "providenum": 70,
            }
        ]


def test_applies_random_jitter_to_final_target_count():
    rng = Random(1)
    expected_offset = Random(1).randint(-5, 5)

    batches = build_random_drain_batches(
        JitterDrainDMAPI(),
        threshold_percent=90,
        jitter_count=5,
        rng=rng,
    )

    selection = batches[0].selections[0]
    assert selection.base_target_count == 90
    assert selection.jitter_offset == expected_offset
    assert selection.final_target_count == 90 + expected_offset
    assert selection.threshold == 90 + expected_offset


class MultiCreditDrainDMAPI(FakeDrainDMAPI):
    def get_creditType_list(self, activity_id):
        return [
            {
                "creditId": "201",
                "scoreId": "301",
                "scorename": "美育实践学分",
                "unitcount": "0.20",
                "num": 100,
                "providenum": 98,
            },
            {
                "creditId": "202",
                "scoreId": "302",
                "scorename": "劳动教育学分",
                "unitcount": "0.30",
                "num": 100,
                "providenum": 98,
            },
        ]

    def get_credit_list(self, url, activity_id, credit_id):
        if url == self.CREDIT_URL_CREDITEDMEM:
            return []
        return [
            {"signUpId": "9001", "userId": "u-001", "name": "张三"},
            {"signUpId": "9002", "userId": "u-002", "name": "李四"},
            {"signUpId": "9003", "userId": "u-003", "name": "王五"},
            {"signUpId": "9004", "userId": "u-004", "name": "赵六"},
        ]


def test_balanced_sampling_spreads_activity_selections_across_people():
    batches = build_random_drain_batches(
        MultiCreditDrainDMAPI(),
        threshold_percent=100,
        jitter_count=0,
        rng=Random(7),
    )

    selected_by_credit = {
        selection.credit_id: {member.sign_up_id for member in selection.selected_members}
        for selection in batches[0].selections
    }

    assert len(selected_by_credit["201"]) == 2
    assert len(selected_by_credit["202"]) == 2
    assert selected_by_credit["201"].isdisjoint(selected_by_credit["202"])


class ExecutingDrainDMAPI(FakeDrainDMAPI):
    SIGN_TYPE_UNSIGNED = 1
    SIGN_TYPE_SIGNED = 2

    def __init__(self):
        super().__init__()
        self.unsigned_by_activity = {"1001": {"9002"}}
        self.credited = {("1001", "201"): {"already"}}
        self.resign_calls = []
        self.send_calls = []

    def get_sign_list(self, activity_id, sign_type):
        sign_up_ids = self.unsigned_by_activity.get(str(activity_id), set())
        return [
            {"signUpId": sign_up_id, "userId": f"u-{sign_up_id}"}
            for sign_up_id in sorted(sign_up_ids)
        ]

    def resign(self, activity_id, sign_up_id_list, is_all=False):
        self.resign_calls.append((str(activity_id), tuple(sign_up_id_list), is_all))
        for sign_up_id in sign_up_id_list:
            self.unsigned_by_activity[str(activity_id)].discard(str(sign_up_id))
        return True

    def send_credit(self, activity_id, credit_id, user_list):
        self.send_calls.append((str(activity_id), str(credit_id), user_list))
        reverse = {"u-001": "9001", "u-002": "9002", "u-003": "9003"}
        for user_id in user_list.split(","):
            self.credited.setdefault((str(activity_id), str(credit_id)), set()).add(
                reverse[user_id]
            )
        return True

    def get_credit_list(self, url, activity_id, credit_id):
        if url == self.CREDIT_URL_CREDITEDMEM:
            return [
                {
                    "signUpId": sign_up_id,
                    "userId": f"u-{sign_up_id}",
                    "name": sign_up_id,
                }
                for sign_up_id in sorted(
                    self.credited.get((str(activity_id), str(credit_id)), set())
                )
            ]
        return super().get_credit_list(url, activity_id, credit_id)


def test_unconfirmed_activity_is_skipped_without_mutation(tmp_path):
    dmapi = ExecutingDrainDMAPI()

    result = run_random_drain_workflow(
        dmapi,
        threshold_percent=72,
        output_dir=tmp_path,
        seed=1,
        input_func=lambda prompt: "NO",
        print_func=lambda message: None,
    )

    assert dmapi.resign_calls == []
    assert dmapi.send_calls == []
    assert result.successes == ()
    assert result.skipped
    assert result.skipped[0].note == "Activity was not confirmed"


def test_confirmed_activity_resigns_once_then_sends_credit_batches(tmp_path):
    dmapi = ExecutingDrainDMAPI()

    result = run_random_drain_workflow(
        dmapi,
        threshold_percent=72,
        output_dir=tmp_path,
        seed=1,
        input_func=lambda prompt: "EXECUTE 1001",
        print_func=lambda message: None,
    )

    assert len(dmapi.resign_calls) == 1
    assert dmapi.resign_calls[0][0] == "1001"
    assert dmapi.resign_calls[0][1] == ("9002",)
    assert dmapi.resign_calls[0][2] is False
    assert dmapi.send_calls == [("1001", "201", "u-002,u-003")]
    assert len(result.successes) == 2
    assert result.failures == ()
