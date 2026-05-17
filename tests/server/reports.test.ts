import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { writeExecutionWorkbook, writeOperationPlanDetailWorkbook, writePlanDetailWorkbook } from "../../server/domain/reports";
import type { ExecutionTask, OperationPlan, Plan } from "../../server/domain/models";

describe("reports", () => {
  it("exports per-person plan details down to credit item value", () => {
    const sheets = readWorkbook(writePlanDetailWorkbook(plan()));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheets.Sheets["个人计划明细"]);

    expect(sheets.SheetNames).toContain("个人计划明细");
    expect(rows[0]).toMatchObject({
      "学号": "20250001",
      "姓名": "张三",
      "活动ID": "activity-1",
      "活动名称": "活动一",
      "计划发放学分类型": "美育实践学分",
      "计划发放学分": "0.50",
    });
  });

  it("exports per-person execution details with actual credit value", () => {
    const sheets = readWorkbook(writeExecutionWorkbook(task()));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheets.Sheets["个人执行明细"]);

    expect(sheets.SheetNames).toContain("个人执行明细");
    expect(rows[0]).toMatchObject({
      "学号": "20250001",
      "姓名": "张三",
      "活动ID": "activity-1",
      "动作": "发放学分",
      "状态": "成功",
      "计划处理学分": "0.50",
      "实际处理学分": "0.50",
    });
  });

  it("exports per-person operation plan details with planned credit value", () => {
    const sheets = readWorkbook(writeOperationPlanDetailWorkbook(operationPlan()));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheets.Sheets["个人操作计划明细"]);

    expect(sheets.SheetNames).toContain("个人操作计划明细");
    expect(rows[0]).toMatchObject({
      "学号": "20250001",
      "姓名": "张三",
      "动作": "发放学分",
      "学分类型": "思想成长学分",
      "计划处理学分": "0.50",
    });
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
      issueSuccessCount: 1,
      abandonSuccessCount: 0,
      skippedAlreadyIssuedCount: 0,
      failedCount: 0,
      details: [{
        studentId: "20250001",
        studentName: "张三",
        activityId: "activity-1",
        activityName: "活动一",
        signUpId: "signup-1",
        userId: "user-1",
        creditId: "credit-1",
        scoreId: "score-1",
        creditType: "美育实践学分",
        plannedValueCent: 50,
        actualValueCent: 50,
        action: "issueCredit",
        status: "success",
        message: "已为 张三 发放 美育实践学分",
      }],
    },
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
      requestedValueCent: 50,
    }],
    activities: [{
      activityId: "activity-1",
      activityName: "活动一",
      creditType: "美育实践学分",
      bundleValueCent: 50,
      bundleCapacity: 10,
      creditItems: [{
        creditId: "credit-1",
        scoreId: "score-1",
        creditType: "美育实践学分",
        unitcountCent: 50,
        remainingCapacity: 10,
      }],
    }],
    allocations: [{
      demand: {
        studentId: "20250001",
        studentName: "张三",
        creditType: "美育实践学分",
        requestedValueCent: 50,
      },
      assignments: [{
        bundle: {
          activityId: "activity-1",
          activityName: "活动一",
          creditType: "美育实践学分",
          bundleValueCent: 50,
          bundleCapacity: 10,
          creditItems: [{
            creditId: "credit-1",
            scoreId: "score-1",
            creditType: "美育实践学分",
            unitcountCent: 50,
            remainingCapacity: 10,
          }],
        },
        signUpId: "signup-1",
        userId: "user-1",
      }],
      plannedValueCent: 50,
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
      activityCount: 1,
      plannedIssueCount: 1,
      notInAdmitCount: 0,
      underIssuedCount: 0,
      overIssuedCount: 0,
      alreadyPartiallyIssuedCount: 0,
      alreadyFullyIssuedCount: 0,
    },
    auditLogs: [],
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
      creditItems: [{
        activityId: "activity-1",
        activityName: "活动一",
        creditId: "credit-1",
        scoreId: "score-1",
        creditType: "思想成长学分",
        unitcountCent: 50,
        totalCapacity: 10,
        issuedCount: 0,
        remainingCapacity: 10,
      }],
    }],
    summary: {
      actionCount: 1,
      enabledCount: 1,
      targetMemberCount: 1,
      targetCreditItemCount: 1,
      expectedResignCount: 0,
      expectedIssueCount: 1,
      expectedAbandonCount: 0,
    },
    auditLogs: [],
  };
}
