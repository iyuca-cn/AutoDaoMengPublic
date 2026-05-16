<template>
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th>启用</th>
          <th>学生</th>
          <th>学分类型</th>
          <th>应发</th>
          <th>计划发</th>
          <th>偏差</th>
          <th>活动</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        <tr v-for="(allocation, index) in modelValue" :key="`${allocation.demand.studentId}-${index}`">
          <td>
            <input class="h-4 w-4 accent-moss" type="checkbox" :checked="allocation.enabled" @change="toggle(index, ($event.target as HTMLInputElement).checked)" />
          </td>
          <td>
            <div class="font-medium">{{ allocation.demand.studentName }}</div>
            <div class="text-xs text-slate-500">{{ allocation.demand.studentId }}</div>
          </td>
          <td>{{ allocation.demand.creditType }}</td>
          <td>{{ formatCent(allocation.demand.requestedValueCent) }}</td>
          <td>{{ formatCent(allocation.plannedValueCent) }}</td>
          <td :class="allocation.deltaCent === 0 ? 'text-moss' : allocation.deltaCent > 0 ? 'text-amber-700' : 'text-clay'">
            {{ formatCent(allocation.deltaCent) }}
          </td>
          <td>
            <div class="flex flex-wrap gap-1">
              <span v-for="assignment in allocation.assignments" :key="`${assignment.bundle.activityId}-${assignment.bundle.bundleValueCent}`" class="rounded border border-line bg-paper px-2 py-1 text-xs">
                {{ assignment.bundle.activityName }} {{ formatCent(assignment.bundle.bundleValueCent) }}
              </span>
            </div>
          </td>
        </tr>
        <tr v-if="modelValue.length === 0">
          <td colspan="7" class="py-8 text-center text-slate-500">暂无计划分配</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { DemandAllocation } from "../types";
import { formatCent } from "../types";

const props = defineProps<{
  modelValue: DemandAllocation[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: DemandAllocation[]];
}>();

function toggle(index: number, enabled: boolean) {
  emit("update:modelValue", props.modelValue.map((item, itemIndex) => (itemIndex === index ? { ...item, enabled } : item)));
}
</script>
