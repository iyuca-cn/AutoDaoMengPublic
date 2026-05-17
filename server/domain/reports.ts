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
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(plan.allocations.map((allocation) => ({
    "学号": allocation.demand.studentId,
    "姓名": allocation.demand.studentName,
    "学分类型": allocation.demand.creditType,
    "应发": formatCreditCent(allocation.demand.requestedValueCent),
    "计划发": formatCreditCent(allocation.plannedValueCent),
    "偏差": formatCreditCent(allocation.deltaCent),
    "活动数": allocation.assignments.length,
  }))), "分配明细");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(plan.notInAdmitList.map((demand) => ({
    "学号": demand.studentId,
    "姓名": demand.studentName,
    "学分类型": demand.creditType,
    "应发": formatCreditCent(demand.requestedValueCent),
  }))), "不在录取名单");
  return workbookToArrayBuffer(workbook);
}

export function writePlanDetailWorkbook(plan: Plan): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(planDetailRows(plan)), "个人计划明细");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(plan.notInAdmitList.map((demand) => ({
    "学号": demand.studentId,
    "姓名": demand.studentName,
    "学分类型": demand.creditType,
    "应发学分": formatCreditCent(demand.requestedValueCent),
    "说明": "不在录取名单",
  }))), "不在录取名单");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(plan.preissued.alreadyPartiallyIssued.map((item) => ({
    "学号": item.studentId,
    "姓名": item.studentName,
    "活动ID": item.activityId,
    "活动名称": item.activityName,
    "学分类型": item.creditType,
    "说明": item.note,
  }))), "部分已发");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(plan.preissued.alreadyFullyIssued.map((item) => ({
    "学号": item.studentId,
    "姓名": item.studentName,
    "活动ID": item.activityId,
    "活动名称": item.activityName,
    "学分类型": item.creditType,
    "说明": item.note,
  }))), "全部已发");
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
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(task.events.map((event) => ({
    "时间": event.time,
    "级别": event.level,
    "消息": event.message,
  }))), "执行事件");
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
  return plan.actions.flatMap((action) => {
    if (action.kind === "resign" || action.creditItems.length === 0) {
      return [{
        "学号": action.studentId ?? "",
        "姓名": action.studentName,
        "活动ID": action.activityId,
        "活动名称": action.activityName,
        "报名ID": action.signUpId,
        "用户ID": action.userId ?? "",
        "动作": operationKindLabel(action.kind),
        "启用": action.enabled ? "是" : "否",
        "状态": action.status,
        "学分项ID": "",
        "分数项ID": "",
        "学分类型": "",
        "计划处理学分": formatCreditCent(0),
        "备注": action.note ?? "",
      }];
    }
    return action.creditItems.map((item) => ({
      "学号": action.studentId ?? "",
      "姓名": action.studentName,
      "活动ID": item.activityId || action.activityId,
      "活动名称": item.activityName || action.activityName,
      "报名ID": action.signUpId,
      "用户ID": action.userId ?? "",
      "动作": operationKindLabel(action.kind),
      "启用": action.enabled ? "是" : "否",
      "状态": action.status,
      "学分项ID": item.creditId,
      "分数项ID": item.scoreId,
      "学分类型": item.creditType,
      "计划处理学分": formatCreditCent(item.unitcountCent),
      "备注": action.note ?? "",
    }));
  });
}

function planDetailRows(plan: Plan): Array<Record<string, string | number>> {
  return plan.allocations.flatMap((allocation) => {
    if (!allocation.enabled) {
      return [{
        "学号": allocation.demand.studentId,
        "姓名": allocation.demand.studentName,
        "需求学分类型": allocation.demand.creditType,
        "应发学分": formatCreditCent(allocation.demand.requestedValueCent),
        "计划学分": formatCreditCent(0),
        "偏差": formatCreditCent(-allocation.demand.requestedValueCent),
        "活动ID": "",
        "活动名称": "",
        "学分项ID": "",
        "分数项ID": "",
        "计划发放学分类型": "",
        "计划发放学分": formatCreditCent(0),
        "报名ID": "",
        "用户ID": "",
        "状态": "已停用",
      }];
    }
    if (allocation.assignments.length === 0) {
      return [{
        "学号": allocation.demand.studentId,
        "姓名": allocation.demand.studentName,
        "需求学分类型": allocation.demand.creditType,
        "应发学分": formatCreditCent(allocation.demand.requestedValueCent),
        "计划学分": formatCreditCent(0),
        "偏差": formatCreditCent(allocation.deltaCent),
        "活动ID": "",
        "活动名称": "",
        "学分项ID": "",
        "分数项ID": "",
        "计划发放学分类型": "",
        "计划发放学分": formatCreditCent(0),
        "报名ID": "",
        "用户ID": "",
        "状态": "未分配",
      }];
    }
    return allocation.assignments.flatMap((assignment) => assignment.bundle.creditItems.map((creditItem) => ({
      "学号": allocation.demand.studentId,
      "姓名": allocation.demand.studentName,
      "需求学分类型": allocation.demand.creditType,
      "应发学分": formatCreditCent(allocation.demand.requestedValueCent),
      "计划学分": formatCreditCent(allocation.plannedValueCent),
      "偏差": formatCreditCent(allocation.deltaCent),
      "活动ID": assignment.bundle.activityId,
      "活动名称": assignment.bundle.activityName,
      "学分项ID": creditItem.creditId,
      "分数项ID": creditItem.scoreId,
      "计划发放学分类型": creditItem.creditType,
      "计划发放学分": formatCreditCent(creditItem.unitcountCent),
      "报名ID": assignment.signUpId,
      "用户ID": assignment.userId,
      "状态": "计划发放",
    })));
  });
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
  return details.map((detail) => ({
    "学号": detail.studentId ?? "",
    "姓名": detail.studentName,
    "活动ID": detail.activityId,
    "活动名称": detail.activityName,
    "报名ID": detail.signUpId ?? "",
    "用户ID": detail.userId ?? "",
    "学分项ID": detail.creditId ?? "",
    "分数项ID": detail.scoreId ?? "",
    "动作": actionLabel(detail.action),
    "状态": detailStatusLabel(detail.status),
    "学分类型": detail.creditType ?? "",
    "计划处理学分": formatCreditCent(detail.plannedValueCent),
    "实际处理学分": formatCreditCent(detail.actualValueCent),
    "说明": detail.message,
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
