<template>
  <div class="grid gap-3">
    <div v-for="group in groups" :key="group.key" class="rounded border border-line bg-white p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 class="font-semibold">{{ group.activityName }}</h4>
          <div class="mt-1 text-xs text-slate-500">{{ group.creditType }} {{ formatCent(group.valueCent) }} · {{ group.scoreId }}</div>
        </div>
        <span class="text-sm text-slate-500">{{ group.count }} 项</span>
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
  const byCreditItem = new Map<string, { key: string; activityName: string; scoreId: string; creditType: string; valueCent: number; count: number; items: string[] }>();
  for (const allocation of props.plan.allocations) {
    for (const assignment of allocation.assignments) {
      const creditItem = assignment.bundle.creditItems[0];
      const scoreId = creditItem?.scoreId || "";
      const key = `${assignment.bundle.activityId}:${assignment.bundle.creditType}:${scoreId}`;
      const group = byCreditItem.get(key) ?? {
        key,
        activityName: assignment.bundle.activityName,
        scoreId,
        creditType: assignment.bundle.creditType,
        valueCent: assignment.bundle.bundleValueCent,
        count: 0,
        items: [],
      };
      group.count += 1;
      group.items.push(`${allocation.demand.studentName} ${allocation.demand.studentId}`);
      byCreditItem.set(key, group);
    }
  }
  return [...byCreditItem.values()];
});
</script>
