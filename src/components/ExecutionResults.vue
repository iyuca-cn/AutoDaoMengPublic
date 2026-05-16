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
</template>

<script setup lang="ts">
import type { ExecutionTask } from "../types";

defineProps<{
  task: ExecutionTask;
}>();
</script>
