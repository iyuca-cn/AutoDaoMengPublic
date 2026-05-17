import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { writeExecutionWorkbook, writeOperationPlanDetailWorkbook, writePlanDetailWorkbook } from "../../server/domain/reports";
import type { ExecutionTask, OperationPlan, Plan } from "../../server/domain/models";

describe("reports", () => {
  it("exports plan details with one row per person and all plan info in that row", () => {
    const sheets = readWorkbook(writePlanDetailWorkbook(plan()));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheets.Sheets["个人计划明细"]);

    expect(sheets.SheetNames).toContain("个人计划明细");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      "学号": "20250001",
      "姓名": "张三",
      "应发学分合计": "1.00",
      "计划处理学分合计": "1.00",
      "活动汇总": "活动一；活动二",
      "学分类型汇总": "美育实践学分；思想成长学分",
    });
    expect(String(rows[0]["明细说明"])).toContain("活动一");
    expect(String(rows[0]["明细说明"])).toContain("活动二");
  });

  it("exports execution details with one row per person and actual credit value total", () => {
    const sheets = readWorkbook(writeExecutionWorkbook(task()));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheets.Sheets["个人执行明细"]);

    expect(sheets.SheetNames).toContain("个人执行明细");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      "学号": "20250001",
      "姓名": "张三",
      "计划处理学分合计": "1.00",
      "实际处理学分合计": "1.00",
      "活动汇总": "活动一；活动二",
    });
    expect(String(rows[0]["明细说明"])).toContain("活动一");
    expect(String(rows[0]["明细说明"])).toContain("活动二");
  });

  it("exports operation plan details with one row per person", () => {
    const sheets = readWorkbook(writeOperationPlanDetailWorkbook(operationPlan()));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheets.Sheets["个人操作计划明细"]);

    expect(sheets.SheetNames).toContain("个人操作计划明细");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      "学号": "20250001",
      "姓名": "张三",
      "计划处理学分合计": "1.00",
      "活动汇总": "活动一；活动二",
      "学分类型汇总": "思想成长学分；美育实践学分",
    });
    expect(String(rows[0]["明细说明"])).toContain("活动一");
    expect(String(rows[0]["明细说明"])).toContain("活动二");
  });
});

function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "array" });
}

function task(): ExecutionTask {
  return {
    id: "task-1",
    planId: "plan-1",
    targetType: "creditPlan",
    targetId: "plan-1",
    status: "completed",
    createdAt: "now",
    updatedAt: "now",
    events: [],
    result: {
      resignSuccessCount: 0,
      issueSuccessCount: 2,
      abandonSuccessCount: 0,
      skippedAlreadyIssuedCount: 0,
      failedCount: 0,
      details: [
        executionDetail("activity-1", "活动一", "credit-1", "score-1", "美育实践学分"),
        executionDetail("activity-2", "活动二", "credit-2", "score-2", "思想成长学分"),
      ],
    },
  };
}

function executionDetail(activityId: string, activityName: string, creditId: string, scoreId: string, creditType: "美育实践学分" | "思想成长学分"): ExecutionTask["result"]["details"][number] {
  return {
    studentId: "20250001",
    studentName: "张三",
    activityId,
    activityName,
    signUpId: `signup-${activityId}`,
    userId: "user-1",
    creditId,
    scoreId,
    creditType,
    plannedValueCent: 50,
    actualValueCent: 50,
    action: "issueCredit",
    status: "success",
    message: `已为 张三 发放 ${creditType}`,
  };
}

function plan(): Plan {
  return {
    id: "plan-1",
    name: "学分计划",
    sourceImportId: "import-1",
    generatedAt: "now",
    status: "ready",
    demands: [{
      studentId: "20250001",
      studentName: "张三",
      creditType: "美育实践学分",
      requestedValueCent: 100,
    }],
    activities: [],
    allocations: [{
      demand: {
        studentId: "20250001",
        studentName: "张三",
        creditType: "美育实践学分",
        requestedValueCent: 100,
      },
      assignments: [
        planAssignment("activity-1", "活动一", "credit-1", "score-1", "美育实践学分"),
        planAssignment("activity-2", "活动二", "credit-2", "score-2", "思想成长学分"),
      ],
      plannedValueCent: 100,
      deltaCent: 0,
      enabled: true,
    }],
    preissued: {
      alreadyPartiallyIssued: [],
      alreadyFullyIssued: [],
    },
    notInAdmitList: [],
    summary: {
      demandCount: 1,
      studentCount: 1,
      activityCount: 2,
      plannedIssueCount: 2,
      notInAdmitCount: 0,
      underIssuedCount: 0,
      overIssuedCount: 0,
      alreadyPartiallyIssuedCount: 0,
      alreadyFullyIssuedCount: 0,
    },
    auditLogs: [],
  };
}

function planAssignment(activityId: string, activityName: string, creditId: string, scoreId: string, creditType: "美育实践学分" | "思想成长学分"): Plan["allocations"][number]["assignments"][number] {
  return {
    bundle: {
      activityId,
      activityName,
      creditType,
      bundleValueCent: 50,
      bundleCapacity: 10,
      creditItems: [{
        creditId,
        scoreId,
        creditType,
        unitcountCent: 50,
        remainingCapacity: 10,
      }],
    },
    signUpId: `signup-${activityId}`,
    userId: "user-1",
  };
}

function operationPlan(): OperationPlan {
  return {
    id: "operation-plan-1",
    name: "操作计划",
    kind: "issueCredit",
    activityId: "activity-1",
    activityName: "活动一",
    createdAt: "now",
    updatedAt: "now",
    status: "ready",
    actions: [{
      id: "action-1",
      kind: "issueCredit",
      activityId: "activity-1",
      activityName: "活动一",
      studentId: "20250001",
      studentName: "张三",
      signUpId: "signup-1",
      userId: "user-1",
      enabled: true,
      status: "planned",
      creditItems: [
        operationCreditItem("activity-1", "活动一", "credit-1", "score-1", "思想成长学分"),
        operationCreditItem("activity-2", "活动二", "credit-2", "score-2", "美育实践学分"),
      ],
    }],
    summary: {
      actionCount: 1,
      enabledCount: 1,
      targetMemberCount: 1,
      targetCreditItemCount: 2,
      expectedResignCount: 0,
      expectedIssueCount: 2,
      expectedAbandonCount: 0,
    },
    auditLogs: [],
  };
}

function operationCreditItem(activityId: string, activityName: string, creditId: string, scoreId: string, creditType: "美育实践学分" | "思想成长学分"): OperationPlan["actions"][number]["creditItems"][number] {
  return {
    activityId,
    activityName,
    creditId,
    scoreId,
    creditType,
    unitcountCent: 50,
    totalCapacity: 10,
    issuedCount: 0,
    remainingCapacity: 10,
  };
}
