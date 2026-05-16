<template>
  <div class="panel p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="font-semibold">生成操作计划</h3>
        <p class="mt-1 text-sm text-slate-600">已选 {{ selectedMembers.length }} 人，{{ selectedCreditItems.length }} 个学分项。</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="text-button" type="button" :disabled="!canResign || loading" @click="create('resign')">
          <UserCheck class="h-4 w-4" />
          生成补签计划
        </button>
        <button class="text-button" type="button" :disabled="!canIssue || loading" @click="create('issueCredit')">
          <BadgeCheck class="h-4 w-4" />
          生成发放计划
        </button>
        <button class="primary-button" type="button" :disabled="!canIssue || loading" @click="create('resignThenIssueCredit')">
          <ListChecks class="h-4 w-4" />
          生成补签后发放计划
        </button>
      </div>
    </div>
    <p v-if="message" class="mt-3 rounded border border-moss/30 bg-mint px-3 py-2 text-sm text-moss">{{ message }}</p>
    <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { BadgeCheck, ListChecks, UserCheck } from "lucide-vue-next";
import { computed, ref } from "vue";
import { apiPost } from "../api";
import type { ActivityCreditItem, ActivityDetail, ActivityPersonRow, OperationKind, OperationPlan } from "../types";

const props = defineProps<{
  detail: ActivityDetail;
  selectedMembers: ActivityPersonRow[];
  selectedCreditItems: ActivityCreditItem[];
}>();

const emit = defineEmits<{
  created: [plan: OperationPlan];
}>();

const loading = ref(false);
const error = ref("");
const message = ref("");
const canResign = computed(() => props.selectedMembers.length > 0);
const canIssue = computed(() => props.selectedMembers.length > 0 && props.selectedCreditItems.length > 0);

async function create(kind: OperationKind) {
  loading.value = true;
  error.value = "";
  message.value = "";
  try {
    const plan = await apiPost<OperationPlan>("/api/operation-plans", {
      kind,
      activityId: props.detail.activityId,
      activityName: props.detail.activityName,
      members: props.selectedMembers,
      creditItems: props.selectedCreditItems,
    });
    message.value = `已生成：${plan.name}`;
    emit("created", plan);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
</script>
