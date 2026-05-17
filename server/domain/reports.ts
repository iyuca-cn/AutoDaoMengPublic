import * as XLSX from "xlsx";
import { formatCreditCent, type ExecutionDetail, type ExecutionTask, type OperationPlan, type Plan } from "./models";

export function writePlanSummaryWorkbook(plan: Plan): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    {
      "计划ID": plan.id,
      "计划名称": plan.name,
      "需求数": plan.summary.demandCount,
      "学生数": plan.summary.studentCount,
      "活动数": plan.summary.activityCount,
      "计划发放项": plan.summary.plannedIssueCount,
      "不在录取名单": plan.summary.notInAdmitCount,
      "少发": plan.summary.underIssuedCount,
      "多发": plan.summary.overIssuedCount,
      "部分已发": plan.summary.alreadyPartiallyIssuedCount,
      "全部已发": plan.summary.alreadyFullyIssuedCount,
    },
  ]), "计划摘要");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(planDetailRows(plan)), "分配明细");
  return workbookToArrayBuffer(workbook);
}

export function writePlanDetailWorkbook(plan: Plan): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(planDetailRows(plan)), "个人计划明细");
  return workbookToArrayBuffer(workbook);
}

export function writeOperationPlanDetailWorkbook(plan: OperationPlan): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(operationPlanDetailRows(plan)), "个人操作计划明细");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
    "计划ID": plan.id,
    "计划名称": plan.name,
    "状态": plan.status,
    "活动数": plan.activityIds?.length ?? 1,
    "动作数": plan.summary.actionCount,
    "启用动作数": plan.summary.enabledCount,
    "目标人数": plan.summary.targetMemberCount,
    "目标学分项": plan.summary.targetCreditItemCount,
    "预计补签": plan.summary.expectedResignCount,
    "预计发放": plan.summary.expectedIssueCount,
    "预计撤销": plan.summary.expectedAbandonCount,
  }]), "计划摘要");
  return workbookToArrayBuffer(workbook);
}

export function writeExecutionWorkbook(task: ExecutionTask): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    {
      "任务ID": task.id,
      "计划ID": task.planId,
      "状态": task.status,
      "补签成功": task.result?.resignSuccessCount ?? 0,
      "发放成功": task.result?.issueSuccessCount ?? 0,
      "撤销成功": task.result?.abandonSuccessCount ?? 0,
      "已发跳过": task.result?.skippedAlreadyIssuedCount ?? 0,
      "失败": task.result?.failedCount ?? 0,
    },
  ]), "执行摘要");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(executionDetailRows(task.result?.details ?? [])), "个人执行明细");
  return workbookToArrayBuffer(workbook);
}

function operationPlanDetailRows(plan: OperationPlan): Array<Record<string, string | number>> {
  const records = plan.actions.flatMap((action) => {
    if (action.kind === "resign" || action.creditItems.length === 0) {
      return [{
        studentId: action.studentId ?? "",
        studentName: action.studentName,
        requestedValueCent: 0,
        plannedValueCent: 0,
        actualValueCent: 0,
        activity: action.activityName,
        creditType: "",
        detail: [
          `${action.activityName} ${operationKindLabel(action.kind)}`,
          `报名ID ${action.signUpId}`,
          `启用 ${action.enabled ? "是" : "否"}`,
          `状态 ${action.status}`,
          action.note ? `备注 ${action.note}` : "",
        ].filter(Boolean).join("；"),
      }];
    }
    return action.creditItems.map((item) => ({
      studentId: action.studentId ?? "",
      studentName: action.studentName,
      requestedValueCent: 0,
      plannedValueCent: item.unitcountCent,
      actualValueCent: 0,
      activity: item.activityName || action.activityName,
      creditType: item.creditType,
      detail: [
        `${item.activityName || action.activityName} ${operationKindLabel(action.kind)} ${item.creditType} ${formatCreditCent(item.unitcountCent)}`,
        `学分项ID ${item.creditId}`,
        `分数项ID ${item.scoreId}`,
        `报名ID ${action.signUpId}`,
        action.userId ? `用户ID ${action.userId}` : "",
        `启用 ${action.enabled ? "是" : "否"}`,
        `状态 ${action.status}`,
        action.note ? `备注 ${action.note}` : "",
      ].filter(Boolean).join("；"),
    }));
  });
  return groupRowsByPerson(records);
}

function planDetailRows(plan: Plan): Array<Record<string, string | number>> {
  const allocationRecords = plan.allocations.flatMap((allocation) => {
    if (!allocation.enabled) {
      return [{
        studentId: allocation.demand.studentId,
        studentName: allocation.demand.studentName,
        requestedValueCent: allocation.demand.requestedValueCent,
        plannedValueCent: 0,
        actualValueCent: 0,
        activity: "",
        creditType: allocation.demand.creditType,
        detail: `${allocation.demand.creditType} 应发 ${formatCreditCent(allocation.demand.requestedValueCent)}：已停用`,
      }];
    }
    if (allocation.assignments.length === 0) {
      return [{
        studentId: allocation.demand.studentId,
        studentName: allocation.demand.studentName,
        requestedValueCent: allocation.demand.requestedValueCent,
        plannedValueCent: 0,
        actualValueCent: 0,
        activity: "",
        creditType: allocation.demand.creditType,
        detail: `${allocation.demand.creditType} 应发 ${formatCreditCent(allocation.demand.requestedValueCent)}：未分配，偏差 ${formatCreditCent(allocation.deltaCent)}`,
      }];
    }
    return allocation.assignments.flatMap((assignment) => assignment.bundle.creditItems.map((creditItem) => ({
      studentId: allocation.demand.studentId,
      studentName: allocation.demand.studentName,
      requestedValueCent: 0,
      plannedValueCent: creditItem.unitcountCent,
      actualValueCent: 0,
      activity: assignment.bundle.activityName,
      creditType: creditItem.creditType,
      detail: [
        `${assignment.bundle.activityName} ${creditItem.creditType} 计划发放 ${formatCreditCent(creditItem.unitcountCent)}`,
        `需求 ${allocation.demand.creditType} 应发 ${formatCreditCent(allocation.demand.requestedValueCent)}`,
        `计划合计 ${formatCreditCent(allocation.plannedValueCent)}`,
        `偏差 ${formatCreditCent(allocation.deltaCent)}`,
        `学分项ID ${creditItem.creditId}`,
        `分数项ID ${creditItem.scoreId}`,
        `报名ID ${assignment.signUpId}`,
        `用户ID ${assignment.userId}`,
      ].join("；"),
    }))).map((record, index) => ({
      ...record,
      requestedValueCent: index === 0 ? allocation.demand.requestedValueCent : 0,
    }));
  });
  const notInAdmitRecords = plan.notInAdmitList.map((demand) => ({
    studentId: demand.studentId,
    studentName: demand.studentName,
    requestedValueCent: 0,
    plannedValueCent: 0,
    actualValueCent: 0,
    activity: "",
    creditType: demand.creditType,
    detail: `${demand.creditType}：不在录取名单`,
  }));
  const partiallyIssuedRecords = plan.preissued.alreadyPartiallyIssued.map((item) => ({
    studentId: item.studentId,
    studentName: item.studentName,
    requestedValueCent: 0,
    plannedValueCent: 0,
    actualValueCent: 0,
    activity: item.activityName,
    creditType: item.creditType,
    detail: `${item.activityName} ${item.creditType}：${item.note}`,
  }));
  const fullyIssuedRecords = plan.preissued.alreadyFullyIssued.map((item) => ({
    studentId: item.studentId,
    studentName: item.studentName,
    requestedValueCent: 0,
    plannedValueCent: 0,
    actualValueCent: 0,
    activity: item.activityName,
    creditType: item.creditType,
    detail: `${item.activityName} ${item.creditType}：${item.note}`,
  }));
  return groupRowsByPerson([...allocationRecords, ...notInAdmitRecords, ...partiallyIssuedRecords, ...fullyIssuedRecords]);
}

function executionDetailRows(details: ExecutionDetail[]): Array<Record<string, string | number>> {
  if (details.length === 0) {
    return [{
      "学号": "",
      "姓名": "",
      "活动ID": "",
      "活动名称": "",
      "动作": "",
      "状态": "",
      "学分类型": "",
      "计划处理学分": "",
      "实际处理学分": "",
      "说明": "暂无个人级执行明细",
    }];
  }
  return groupRowsByPerson(details.map((detail) => ({
    studentId: detail.studentId ?? "",
    studentName: detail.studentName,
    requestedValueCent: 0,
    plannedValueCent: detail.plannedValueCent,
    actualValueCent: detail.actualValueCent,
    activity: detail.activityName,
    creditType: detail.creditType ?? "",
    detail: [
      `${detail.activityName} ${actionLabel(detail.action)} ${detail.creditType ?? ""}`.trim(),
      `状态 ${detailStatusLabel(detail.status)}`,
      `计划 ${formatCreditCent(detail.plannedValueCent)}`,
      `实际 ${formatCreditCent(detail.actualValueCent)}`,
      detail.creditId ? `学分项ID ${detail.creditId}` : "",
      detail.scoreId ? `分数项ID ${detail.scoreId}` : "",
      detail.signUpId ? `报名ID ${detail.signUpId}` : "",
      detail.userId ? `用户ID ${detail.userId}` : "",
      detail.message,
    ].filter(Boolean).join("；"),
  })));
}

interface PersonAggregateInput {
  studentId?: string;
  studentName: string;
  requestedValueCent: number;
  plannedValueCent: number;
  actualValueCent: number;
  activity: string;
  creditType: string;
  detail: string;
}

interface PersonAggregate {
  studentId: string;
  studentName: string;
  requestedValueCent: number;
  plannedValueCent: number;
  actualValueCent: number;
  activities: Set<string>;
  creditTypes: Set<string>;
  details: string[];
}

function groupRowsByPerson(records: PersonAggregateInput[]): Array<Record<string, string | number>> {
  const groups = new Map<string, PersonAggregate>();
  for (const record of records) {
    const studentId = String(record.studentId ?? "").trim();
    const studentName = record.studentName.trim();
    const key = studentId || studentName;
    const existing = groups.get(key) ?? {
      studentId,
      studentName,
      requestedValueCent: 0,
      plannedValueCent: 0,
      actualValueCent: 0,
      activities: new Set<string>(),
      creditTypes: new Set<string>(),
      details: [],
    };
    existing.studentId ||= studentId;
    existing.studentName ||= studentName;
    existing.requestedValueCent += record.requestedValueCent;
    existing.plannedValueCent += record.plannedValueCent;
    existing.actualValueCent += record.actualValueCent;
    if (record.activity) {
      existing.activities.add(record.activity);
    }
    if (record.creditType) {
      existing.creditTypes.add(record.creditType);
    }
    if (record.detail) {
      existing.details.push(record.detail);
    }
    groups.set(key, existing);
  }
  return [...groups.values()].map((group) => ({
    "学号": group.studentId,
    "姓名": group.studentName,
    "应发学分合计": formatCreditCent(group.requestedValueCent),
    "计划处理学分合计": formatCreditCent(group.plannedValueCent),
    "实际处理学分合计": formatCreditCent(group.actualValueCent),
    "活动汇总": [...group.activities].join("；"),
    "学分类型汇总": [...group.creditTypes].join("；"),
    "明细说明": group.details.join("\n"),
  }));
}

function actionLabel(action: ExecutionDetail["action"]): string {
  const labels: Record<ExecutionDetail["action"], string> = {
    resign: "补签",
    issueCredit: "发放学分",
    abandonCredit: "撤销学分",
  };
  return labels[action];
}

function operationKindLabel(kind: OperationPlan["kind"]): string {
  const labels: Record<OperationPlan["kind"], string> = {
    resign: "补签",
    issueCredit: "发放学分",
    resignThenIssueCredit: "补签后发放学分",
    abandonCredit: "撤销学分",
  };
  return labels[kind];
}

function detailStatusLabel(status: ExecutionDetail["status"]): string {
  const labels: Record<ExecutionDetail["status"], string> = {
    success: "成功",
    skipped: "跳过",
    failed: "失败",
  };
  return labels[status];
}

function workbookToArrayBuffer(workbook: XLSX.WorkBook): ArrayBuffer {
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return buffer;
}
