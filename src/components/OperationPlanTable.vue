<template>
  <div class="grid gap-4">
    <div class="grid gap-3 md:grid-cols-5">
      <div v-for="item in summary" :key="item.label" class="rounded border border-line bg-paper p-3">
        <div class="text-xs text-slate-500">{{ item.label }}</div>
        <div class="mt-1 text-xl font-semibold">{{ item.value }}</div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>启用</th>
            <th>活动</th>
            <th>人员</th>
            <th>操作</th>
            <th>学分项</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="(action, index) in modelValue" :key="action.id">
            <td>
              <input
                class="h-4 w-4 accent-moss"
                type="checkbox"
                :checked="action.enabled"
                :disabled="readonly"
                @change="update(index, { enabled: !action.enabled, status: action.enabled ? 'disabled' : 'planned' })"
              />
            </td>
            <td>
              <div class="font-medium">{{ action.activityName || plan.activityName }}</div>
              <div class="text-xs text-slate-500">{{ action.activityId || plan.activityId }}</div>
            </td>
            <td>
              <div class="font-medium">{{ action.studentName }}</div>
              <div class="text-xs text-slate-500">{{ action.studentId || "-" }} · {{ action.signUpId }}</div>
            </td>
            <td>{{ kindLabel(action.kind) }}</td>
            <td>
              <div class="flex flex-wrap gap-1">
                <span v-for="item in action.creditItems" :key="`${action.id}-${item.scoreId}`" class="rounded border border-line bg-paper px-2 py-1 text-xs">
                  {{ item.creditType }} {{ formatCent(item.unitcountCent) }}
                </span>
                <span v-if="action.creditItems.length === 0" class="text-slate-500">无</span>
              </div>
            </td>
            <td>{{ action.status }}</td>
          </tr>
          <tr v-if="modelValue.length === 0">
            <td colspan="6" class="py-8 text-center text-slate-500">暂无动作</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { OperationAction, OperationKind, OperationPlan } from "../types";
import { formatCent } from "../types";

const props = defineProps<{
  plan: OperationPlan;
  modelValue: OperationAction[];
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [actions: OperationAction[]];
}>();

const summary = computed(() => [
  { label: "动作", value: props.plan.summary.actionCount },
  { label: "启用", value: props.plan.summary.enabledCount },
  { label: "人员", value: props.plan.summary.targetMemberCount },
  { label: "预计补签", value: props.plan.summary.expectedResignCount },
  { label: "预计发放", value: props.plan.summary.expectedIssueCount },
]);

function update(index: number, patch: Partial<OperationAction>) {
  const next = props.modelValue.map((action, currentIndex) => currentIndex === index ? { ...action, ...patch } : action);
  emit("update:modelValue", next);
}

function kindLabel(kind: OperationKind): string {
  const labels: Record<OperationKind, string> = {
    resign: "补签",
    issueCredit: "发放",
    resignThenIssueCredit: "补签后发放",
  };
  return labels[kind];
}
</script>
