<template>
  <div class="rounded border border-line bg-paper p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h4 class="font-semibold">执行预检</h4>
      <span class="rounded px-2 py-1 text-xs font-medium" :class="report.executable ? 'bg-mint text-moss' : 'bg-red-50 text-clay'">
        {{ report.executable ? "可执行" : "不可执行" }}
      </span>
    </div>
    <p class="mt-1 text-sm text-slate-600">待执行动作 {{ report.actionCount }} 项</p>
    <ul class="mt-3 grid gap-2 text-sm">
      <li v-for="issue in report.issues" :key="`${issue.code}-${issue.message}`" class="rounded border px-3 py-2" :class="issue.level === 'error' ? 'border-clay/30 bg-red-50 text-clay' : 'border-amber-200 bg-amber-50 text-amber-800'">
        {{ issue.message }}
      </li>
      <li v-if="report.issues.length === 0" class="text-slate-500">没有预检问题</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  report: {
    executable: boolean;
    actionCount: number;
    issues: Array<{ level: string; code: string; message: string }>;
  };
}>();
</script>
