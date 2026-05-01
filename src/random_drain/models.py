from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class CandidateMember:
    sign_up_id: str
    user_id: str
    name: str


@dataclass(frozen=True, slots=True)
class CreditDrainSelection:
    activity_id: str
    activity_name: str
    credit_id: str
    credit_type: str
    total_capacity: int
    provided_count: int
    threshold: int
    selected_members: tuple[CandidateMember, ...]
    candidate_count: int
    status: str
    note: str = ""
    threshold_percent: int | None = None
    base_target_count: int | None = None
    jitter_offset: int = 0
    final_target_count: int | None = None

    @property
    def planned_issue_count(self) -> int:
        return len(self.selected_members)


@dataclass(frozen=True, slots=True)
class ActivityDrainBatch:
    activity_id: str
    activity_name: str
    selections: tuple[CreditDrainSelection, ...]

    @property
    def planned_issue_count(self) -> int:
        return sum(selection.planned_issue_count for selection in self.selections)


@dataclass(frozen=True, slots=True)
class DrainRecord:
    activity_id: str
    activity_name: str
    credit_type: str
    credit_id: str
    sign_up_id: str
    user_id: str
    name: str
    note: str


@dataclass(frozen=True, slots=True)
class RandomDrainResult:
    batch_dir: Path
    selections: tuple[CreditDrainSelection, ...]
    successes: tuple[DrainRecord, ...]
    failures: tuple[DrainRecord, ...]
    skipped: tuple[DrainRecord, ...]
