<template>
  <div class="grid gap-3 sm:grid-cols-5">
    <div class="rounded border border-line bg-paper p-3">
      <div class="text-xs text-slate-500">补签成功</div>
      <div class="mt-1 text-xl font-semibold">{{ task.result?.resignSuccessCount ?? 0 }}</div>
    </div>
    <div class="rounded border border-line bg-paper p-3">
      <div class="text-xs text-slate-500">发放成功</div>
      <div class="mt-1 text-xl font-semibold">{{ task.result?.issueSuccessCount ?? 0 }}</div>
    </div>
    <div class="rounded border border-line bg-paper p-3">
      <div class="text-xs text-slate-500">撤销成功</div>
      <div class="mt-1 text-xl font-semibold">{{ task.result?.abandonSuccessCount ?? 0 }}</div>
    </div>
    <div class="rounded border border-line bg-paper p-3">
      <div class="text-xs text-slate-500">已发跳过</div>
      <div class="mt-1 text-xl font-semibold">{{ task.result?.skippedAlreadyIssuedCount ?? 0 }}</div>
    </div>
    <div class="rounded border border-line bg-paper p-3">
      <div class="text-xs text-slate-500">失败</div>
      <div class="mt-1 text-xl font-semibold">{{ task.result?.failedCount ?? 0 }}</div>
    </div>
  </div>
  <div v-if="task.result?.details?.length" class="mt-3 rounded border border-line bg-paper p-3 text-sm text-slate-600">
    已生成 {{ task.result.details.length }} 条个人执行明细，导出文件包含每条记录的学生、活动、学分项、计划处理学分和实际处理学分。
  </div>
</template>

<script setup lang="ts">
import type { ExecutionTask } from "../types";

defineProps<{
  task: ExecutionTask;
}>();
</script>
