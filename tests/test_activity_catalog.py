from credit_workflow.activity_catalog import build_activity_bundles


class FakeDMAPI:
    def get_mime_manage_activity_dict(self):
        return {
            "1001": {
                "activityId": 1001,
                "name": "美育活动A",
            }
        }

    def get_creditType_list(self, activity_id):
        assert activity_id == "1001"
        return [
            {
                "creditId": 201,
                "scoreId": 301,
                "scorename": "美育实践学分",
                "scoretypename": "学分",
                "unitcount": "0.20",
                "num": 12,
                "providenum": 0,
                "finish": False,
            },
            {
                "creditId": 202,
                "scoreId": 301,
                "scorename": "美育实践学分",
                "scoretypename": "学分",
                "unitcount": "0.30",
                "num": 10,
                "providenum": 1,
                "finish": False,
            },
            {
                "creditId": 203,
                "scoreId": 999,
                "scorename": "志愿服务学分",
                "scoretypename": "学分",
                "unitcount": "0.50",
                "num": 8,
                "providenum": 0,
                "finish": False,
            },
        ]


class FlakyCatalogDMAPI(FakeDMAPI):
    def __init__(self):
        self.activity_results = [
            None,
            {
                "1001": {
                    "activityId": 1001,
                    "name": "美育活动A",
                }
            },
        ]
        self.credit_results = {
            "1001": [
                None,
                super().get_creditType_list("1001"),
            ]
        }
        self.activity_calls = 0
        self.credit_calls = 0

    def get_mime_manage_activity_dict(self):
        self.activity_calls += 1
        return self.activity_results.pop(0)

    def get_creditType_list(self, activity_id):
        self.credit_calls += 1
        return self.credit_results[str(activity_id)].pop(0)


def test_splits_same_activity_same_type_credit_rows_into_separate_bundles():
    bundles = build_activity_bundles(FakeDMAPI())

    assert len(bundles) == 2
    assert [bundle.activity_id for bundle in bundles] == ["1001", "1001"]
    assert [bundle.activity_name for bundle in bundles] == ["美育活动A", "美育活动A"]
    assert [bundle.credit_type for bundle in bundles] == ["美育实践学分", "美育实践学分"]
    assert [bundle.bundle_value_cent for bundle in bundles] == [20, 30]
    assert [bundle.bundle_capacity for bundle in bundles] == [12, 9]
    assert [[item.credit_id for item in bundle.credit_items] for bundle in bundles] == [["201"], ["202"]]


def test_discards_unsupported_credit_types():
    bundles = build_activity_bundles(FakeDMAPI())

    assert {bundle.credit_type for bundle in bundles} == {"美育实践学分"}


def test_retries_recoverable_activity_and_credit_catalog_reads():
    dmapi = FlakyCatalogDMAPI()

    bundles = build_activity_bundles(dmapi, retry_attempts=2)

    assert len(bundles) == 2
    assert all(bundle.activity_id == "1001" for bundle in bundles)
    assert dmapi.activity_calls == 2
    assert dmapi.credit_calls == 2
