<template>
  <section class="grid gap-4">
    <div class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">{{ detail.activityName }}</h2>
          <p class="mt-1 text-sm text-slate-600">
            {{ detail.activityId }} · {{ detail.hasSignCard ? "有签到卡" : "无签到卡" }} · {{ allMembers.length }} 人
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="text-button" type="button" @click="$emit('back')">
            <ArrowLeft class="h-4 w-4" />
            返回
          </button>
          <button class="primary-button" type="button" @click="$emit('refresh')">
            <RefreshCw class="h-4 w-4" />
            刷新详情
          </button>
        </div>
      </div>
      <div class="mt-4 grid gap-3 md:grid-cols-4">
        <div v-for="item in stats" :key="item.label" class="rounded border border-line bg-paper p-3">
          <div class="text-xs text-slate-500">{{ item.label }}</div>
          <div class="mt-1 text-xl font-semibold">{{ item.value }}</div>
        </div>
      </div>
    </div>

    <OperationPlanCreator
      :detail="detail"
      :selected-members="selectedMembers"
      :selected-credit-items="selectedCreditItems"
      @created="$emit('plan-created', $event)"
    />

    <div class="panel p-4">
      <div class="grid gap-3 md:grid-cols-6">
        <label class="grid gap-1">
          <span class="label">姓名</span>
          <input class="field" v-model.trim="filters.name" />
        </label>
        <label class="grid gap-1">
          <span class="label">学号</span>
          <input class="field" v-model.trim="filters.studentId" />
        </label>
        <label class="grid gap-1">
          <span class="label">报名 ID</span>
          <input class="field" v-model.trim="filters.signUpId" />
        </label>
        <label class="grid gap-1">
          <span class="label">用户 ID</span>
          <input class="field" v-model.trim="filters.userId" />
        </label>
        <label class="grid gap-1">
          <span class="label">签到</span>
          <select class="field" v-model="filters.signStatus">
            <option value="">全部</option>
            <option value="unsigned">未签</option>
            <option value="signed">已签</option>
            <option value="signout">签退</option>
            <option value="leave">请假</option>
          </select>
        </label>
        <label class="grid gap-1">
          <span class="label">名单</span>
          <select class="field" v-model="filters.admitStatus">
            <option value="">全部</option>
            <option value="register">报名</option>
            <option value="admit">录取</option>
            <option value="leave">请假</option>
          </select>
        </label>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button class="text-button" type="button" @click="selectAll">
          <ListPlus class="h-4 w-4" />
          选择当前人员
        </button>
        <button class="text-button" type="button" @click="selectedSignUpIds = []">
          <X class="h-4 w-4" />
          清空人员
        </button>
      </div>
    </div>

    <ActivityMemberTable :rows="filteredMembers" :selected-ids="selectedSignUpIds" @toggle="toggleMember" />

    <CreditIssueTable
      :credit-items="detail.creditItems"
      :credit-lists-by-score-id="detail.creditListsByScoreId"
      :selected-credit-item-keys="selectedCreditItemKeys"
      @toggle-credit="toggleCredit"
    />
  </section>
</template>

<script setup lang="ts">
import { ArrowLeft, ListPlus, RefreshCw, X } from "lucide-vue-next";
import { computed, reactive, ref } from "vue";
import ActivityMemberTable from "./ActivityMemberTable.vue";
import CreditIssueTable from "./CreditIssueTable.vue";
import OperationPlanCreator from "./OperationPlanCreator.vue";
import type { ActivityCreditItem, ActivityDetail, ActivityPersonRow, OperationPlan } from "../types";

const props = defineProps<{
  detail: ActivityDetail;
}>();

defineEmits<{
  back: [];
  refresh: [];
  "plan-created": [plan: OperationPlan];
}>();

const selectedSignUpIds = ref<string[]>([]);
const selectedCreditItemKeys = ref<string[]>([]);
const filters = reactive({
  name: "",
  studentId: "",
  signUpId: "",
  userId: "",
  signStatus: "",
  admitStatus: "",
});

const allMembers = computed(() => {
  const rows = [
    ...Object.values(props.detail.signLists).flat(),
    ...Object.values(props.detail.memberLists).flat(),
  ];
  const byKey = new Map<string, ActivityPersonRow>();
  for (const row of rows) {
    const key = row.signUpId || `${row.studentId ?? ""}:${row.studentName}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      ...existing,
      ...row,
      userId: preferredUserId(existing?.userId, row.userId),
      signStatus: existing?.signStatus ?? row.signStatus,
      admitStatus: existing?.admitStatus ?? row.admitStatus,
    });
  }
  return [...byKey.values()];
});

const filteredMembers = computed(() => allMembers.value.filter((person) => {
  return (!filters.name || person.studentName.includes(filters.name))
    && (!filters.studentId || person.studentId?.includes(filters.studentId))
    && (!filters.signUpId || person.signUpId?.includes(filters.signUpId))
    && (!filters.userId || person.userId?.includes(filters.userId))
    && (!filters.signStatus || person.signStatus === filters.signStatus)
    && (!filters.admitStatus || person.admitStatus === filters.admitStatus);
}));

const selectedMembers = computed(() => {
  const ids = new Set(selectedSignUpIds.value);
  return allMembers.value.filter((person) => person.signUpId && ids.has(person.signUpId));
});

const selectedCreditItems = computed<ActivityCreditItem[]>(() => {
  const keys = new Set(selectedCreditItemKeys.value);
  return props.detail.creditItems.filter((item) => keys.has(creditItemKey(item)));
});

const stats = computed(() => [
  { label: "未签", value: props.detail.signLists.unsigned.length },
  { label: "已签", value: props.detail.signLists.signed.length },
  { label: "录取", value: props.detail.memberLists.admit.length },
  { label: "学分项", value: props.detail.creditItems.length },
]);

function toggleMember(signUpId: string) {
  selectedSignUpIds.value = selectedSignUpIds.value.includes(signUpId)
    ? selectedSignUpIds.value.filter((id) => id !== signUpId)
    : [...selectedSignUpIds.value, signUpId];
}

function toggleCredit(key: string) {
  selectedCreditItemKeys.value = selectedCreditItemKeys.value.includes(key)
    ? selectedCreditItemKeys.value.filter((item) => item !== key)
    : [...selectedCreditItemKeys.value, key];
}

function selectAll() {
  selectedSignUpIds.value = [...new Set([
    ...selectedSignUpIds.value,
    ...filteredMembers.value.map((person) => person.signUpId).filter((id): id is string => Boolean(id)),
  ])];
}

function creditItemKey(item: ActivityCreditItem): string {
  return [item.scoreId, item.creditId, item.creditType, item.unitcountCent].join(":");
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
