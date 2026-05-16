import * as XLSX from "xlsx";
import { formatCreditCent, type Plan, type ExecutionTask } from "./models";

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
      "已发跳过": task.result?.skippedAlreadyIssuedCount ?? 0,
      "失败": task.result?.failedCount ?? 0,
    },
  ]), "执行摘要");
  return workbookToArrayBuffer(workbook);
}

function workbookToArrayBuffer(workbook: XLSX.WorkBook): ArrayBuffer {
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return buffer;
}
