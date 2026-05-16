<template>
  <div class="grid gap-3">
    <div v-for="group in groups" :key="group.activityId" class="rounded border border-line bg-white p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h4 class="font-semibold">{{ group.activityName }}</h4>
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
  const byActivity = new Map<string, { activityId: string; activityName: string; count: number; items: string[] }>();
  for (const allocation of props.plan.allocations) {
    for (const assignment of allocation.assignments) {
      const group = byActivity.get(assignment.bundle.activityId) ?? {
        activityId: assignment.bundle.activityId,
        activityName: assignment.bundle.activityName,
        count: 0,
        items: [],
      };
      group.count += 1;
      group.items.push(`${allocation.demand.studentName} ${assignment.bundle.creditType} ${formatCent(assignment.bundle.bundleValueCent)}`);
      byActivity.set(assignment.bundle.activityId, group);
    }
  }
  return [...byActivity.values()];
});
</script>
