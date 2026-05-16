<template>
  <div class="grid gap-3">
    <div v-for="group in groups" :key="group.studentId" class="rounded border border-line bg-white p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h4 class="font-semibold">{{ group.studentName }}</h4>
        <span class="text-sm text-slate-500">{{ group.studentId }}</span>
      </div>
      <div class="mt-2 flex flex-wrap gap-2">
        <span v-for="item in group.items" :key="item" class="rounded border border-line bg-paper px-2 py-1 text-xs">{{ item }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Plan } from "../types";
import { formatCent } from "../types";

const props = defineProps<{ plan: Plan }>();

const groups = computed(() => {
  const byStudent = new Map<string, { studentId: string; studentName: string; items: string[] }>();
  for (const allocation of props.plan.allocations) {
    const group = byStudent.get(allocation.demand.studentId) ?? {
      studentId: allocation.demand.studentId,
      studentName: allocation.demand.studentName,
      items: [],
    };
    group.items.push(`${allocation.demand.creditType} 应发 ${formatCent(allocation.demand.requestedValueCent)}，计划 ${formatCent(allocation.plannedValueCent)}`);
    byStudent.set(allocation.demand.studentId, group);
  }
  return [...byStudent.values()];
});
</script>
