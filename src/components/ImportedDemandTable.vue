<template>
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th>参与</th>
          <th>学号</th>
          <th>姓名</th>
          <th>学分类型优先级</th>
          <th>学分数值</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        <tr v-for="(demand, index) in modelValue" :key="`${demand.studentId}-${index}`">
          <td>
            <input class="h-4 w-4 accent-moss" type="checkbox" :checked="demand.enabled" @change="update(index, { enabled: ($event.target as HTMLInputElement).checked })" />
          </td>
          <td>
            <input class="field w-36" :value="demand.studentId" @input="update(index, { studentId: ($event.target as HTMLInputElement).value })" />
          </td>
          <td>
            <input class="field w-28" :value="demand.studentName" @input="update(index, { studentName: ($event.target as HTMLInputElement).value })" />
          </td>
          <td>
            <input class="field min-w-60" :value="demand.creditTypes.join('，')" @input="updateTypes(index, ($event.target as HTMLInputElement).value)" />
          </td>
          <td>
            <input class="field w-24" :value="formatCent(demand.requestedValueCent)" @input="updateCent(index, ($event.target as HTMLInputElement).value)" />
          </td>
        </tr>
        <tr v-if="modelValue.length === 0">
          <td colspan="5" class="py-8 text-center text-slate-500">暂无聚合需求</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { PriorityDemandRecord, SupportedCreditType } from "../types";
import { formatCent } from "../types";

const props = defineProps<{
  modelValue: PriorityDemandRecord[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: PriorityDemandRecord[]];
}>();

function update(index: number, patch: Partial<PriorityDemandRecord>) {
  const next = props.modelValue.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
  emit("update:modelValue", next);
}

function updateTypes(index: number, text: string) {
  update(index, { creditTypes: text.split(/[,，]/).map((item) => item.trim()).filter(Boolean) as SupportedCreditType[] });
}

function updateCent(index: number, text: string) {
  const parsed = Number(text);
  if (!Number.isNaN(parsed)) {
    update(index, { requestedValueCent: Math.round(parsed * 100) });
  }
}
</script>
