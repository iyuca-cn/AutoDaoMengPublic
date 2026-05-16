<template>
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <div v-for="item in items" :key="item.label" class="rounded border border-line bg-paper p-3">
      <div class="text-xs text-slate-500">{{ item.label }}</div>
      <div class="mt-1 text-xl font-semibold text-ink">{{ item.value }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Plan } from "../types";

const props = defineProps<{
  plan: Plan;
}>();

const items = computed(() => [
  { label: "需求数", value: props.plan.summary.demandCount },
  { label: "学生数", value: props.plan.summary.studentCount },
  { label: "活动数", value: props.plan.summary.activityCount },
  { label: "计划发放项", value: props.plan.summary.plannedIssueCount },
  { label: "不在录取名单", value: props.plan.summary.notInAdmitCount },
  { label: "少发", value: props.plan.summary.underIssuedCount },
  { label: "多发", value: props.plan.summary.overIssuedCount },
  { label: "已发预览", value: props.plan.summary.alreadyPartiallyIssuedCount + props.plan.summary.alreadyFullyIssuedCount },
]);
</script>
