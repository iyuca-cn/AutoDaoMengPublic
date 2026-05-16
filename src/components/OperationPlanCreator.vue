<template>
  <div class="panel p-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="font-semibold">生成操作计划</h3>
        <p class="mt-1 text-sm text-slate-600">计划人员 {{ effectiveMembers.length }} 人，学分项 {{ effectiveCreditItems.length }} 个。</p>
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
const effectiveMembers = computed(() => props.selectedMembers.length > 0 ? props.selectedMembers : selectableMembers(props.detail));
const effectiveCreditItems = computed(() => props.selectedCreditItems.length > 0 ? props.selectedCreditItems : props.detail.creditItems);
const canResign = computed(() => effectiveMembers.value.length > 0);
const canIssue = computed(() => effectiveMembers.value.length > 0 && effectiveCreditItems.value.length > 0);

async function create(kind: OperationKind) {
  loading.value = true;
  error.value = "";
  message.value = "";
  try {
    const plan = await apiPost<OperationPlan>("/api/operation-plans", {
      kind,
      activityId: props.detail.activityId,
      activityName: props.detail.activityName,
      members: effectiveMembers.value,
      creditItems: kind === "resign" ? [] : effectiveCreditItems.value,
    });
    message.value = `已生成：${plan.name}`;
    emit("created", plan);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function selectableMembers(detail: ActivityDetail): ActivityPersonRow[] {
  const rows = [
    ...Object.values(detail.signLists).flat(),
    ...Object.values(detail.memberLists).flat(),
  ];
  const byKey = new Map<string, ActivityPersonRow>();
  for (const row of rows) {
    if (!row.signUpId) {
      continue;
    }
    const existing = byKey.get(row.signUpId);
    byKey.set(row.signUpId, {
      ...existing,
      ...row,
      userId: preferredUserId(existing?.userId, row.userId),
      signStatus: existing?.signStatus ?? row.signStatus,
      admitStatus: existing?.admitStatus ?? row.admitStatus,
    });
  }
  return [...byKey.values()];
}

function preferredUserId(left?: string, right?: string): string | undefined {
  if (isValidUserId(right)) {
    return right;
  }
  if (isValidUserId(left)) {
    return left;
  }
  return right || left;
}

function isValidUserId(value?: string): boolean {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/[\u4e00-\u9fff]/u.test(text);
}
</script>
