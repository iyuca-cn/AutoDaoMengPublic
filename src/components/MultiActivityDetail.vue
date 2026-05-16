<template>
  <section class="grid gap-4">
    <div class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">跨活动详情</h2>
          <p class="mt-1 text-sm text-slate-600">
            已读取 {{ details.length }} 个活动，失败 {{ errors.length }} 个。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="text-button" type="button" @click="$emit('back')">
            <ArrowLeft class="h-4 w-4" />
            返回
          </button>
          <button class="primary-button" type="button" :disabled="loading" @click="$emit('refresh')">
            <RefreshCw class="h-4 w-4" />
            刷新详情
          </button>
        </div>
      </div>
      <p v-if="progressMessage" class="mt-3 rounded border border-moss/30 bg-mint px-3 py-2 text-sm text-moss">{{ progressMessage }}</p>
      <p v-if="localMessage" class="mt-3 rounded border border-moss/30 bg-mint px-3 py-2 text-sm text-moss">{{ localMessage }}</p>
      <p v-if="localError" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ localError }}</p>
    </div>

    <div class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="font-semibold">生成跨活动操作计划</h3>
          <p class="mt-1 text-sm text-slate-600">已选 {{ selectedMemberCount }} 人，学分项 {{ selectedCreditCount }} 个。</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="text-button" type="button" :disabled="!canResign || creating" @click="create('resign')">
            <UserCheck class="h-4 w-4" />
            生成补签计划
          </button>
          <button class="text-button" type="button" :disabled="!canIssue || creating" @click="create('issueCredit')">
            <BadgeCheck class="h-4 w-4" />
            生成发放计划
          </button>
          <button class="primary-button" type="button" :disabled="!canIssue || creating" @click="create('resignThenIssueCredit')">
            <ListChecks class="h-4 w-4" />
            生成补签后发放计划
          </button>
        </div>
      </div>
    </div>

    <div v-if="errors.length > 0" class="panel p-4">
      <h3 class="font-semibold">读取失败</h3>
      <div class="mt-3 grid gap-2">
        <div v-for="error in errors" :key="error.activityId" class="rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">
          {{ error.activityId }} · {{ error.message }}
        </div>
      </div>
    </div>

    <div v-for="detail in details" :key="detail.activityId" class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="font-semibold">{{ detail.activityName }}</h3>
          <p class="mt-1 text-sm text-slate-600">
            {{ detail.activityId }} · {{ detail.hasSignCard ? "有签到卡" : "无签到卡" }} · {{ membersByActivity(detail).length }} 人
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="text-button" type="button" @click="selectAllMembers(detail)">
            <ListPlus class="h-4 w-4" />
            选择人员
          </button>
          <button class="text-button" type="button" @click="selectAllCredits(detail)">
            <BadgeCheck class="h-4 w-4" />
            选择学分项
          </button>
          <button class="text-button" type="button" @click="clearActivity(detail.activityId)">
            <X class="h-4 w-4" />
            清空
          </button>
        </div>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-[1fr_24rem]">
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th class="w-10">选</th>
                <th>人员</th>
                <th>签到</th>
                <th>名单</th>
                <th>用户 ID</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr v-for="member in membersByActivity(detail)" :key="member.signUpId || `${member.studentId}-${member.studentName}`">
                <td>
                  <input
                    class="h-4 w-4 accent-moss"
                    type="checkbox"
                    :checked="isMemberSelected(detail.activityId, member.signUpId)"
                    :disabled="!member.signUpId"
                    @change="toggleMember(detail.activityId, member.signUpId)"
                  />
                </td>
                <td>
                  <div class="font-medium">{{ member.studentName }}</div>
                  <div class="text-xs text-slate-500">{{ member.studentId || "-" }} · {{ member.signUpId || "-" }}</div>
                </td>
                <td>{{ member.signStatus || "-" }}</td>
                <td>{{ member.admitStatus || "-" }}</td>
                <td>{{ member.userId || "-" }}</td>
              </tr>
              <tr v-if="membersByActivity(detail).length === 0">
                <td colspan="5" class="py-6 text-center text-slate-500">暂无人员</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="grid content-start gap-2">
          <label
            v-for="item in detail.creditItems"
            :key="creditItemKey(item)"
            class="flex items-start gap-2 rounded border border-line bg-paper p-2 text-sm"
          >
            <input
              class="mt-1 h-4 w-4 accent-moss"
              type="checkbox"
              :checked="isCreditSelected(detail.activityId, creditItemKey(item))"
              @change="toggleCredit(detail.activityId, creditItemKey(item))"
            />
            <span>
              <span class="font-medium">{{ item.creditType }} {{ formatCent(item.unitcountCent) }}</span>
              <span class="block text-xs text-slate-500">已发 {{ item.issuedCount }} · 剩余 {{ item.remainingCapacity }}</span>
            </span>
          </label>
          <p v-if="detail.creditItems.length === 0" class="text-sm text-slate-500">暂无学分项</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { ArrowLeft, BadgeCheck, ListChecks, ListPlus, RefreshCw, UserCheck, X } from "lucide-vue-next";
import { apiPost } from "../api";
import type { ActivityCreditItem, ActivityDetail, ActivityPersonRow, OperationKind, OperationPlan } from "../types";
import { formatCent } from "../types";

const props = defineProps<{
  details: ActivityDetail[];
  errors: Array<{ activityId: string; message: string }>;
  loading?: boolean;
  progressMessage?: string;
}>();

const emit = defineEmits<{
  back: [];
  refresh: [];
  "plan-created": [plan: OperationPlan];
}>();

const selectedMembersByActivity = reactive<Record<string, string[]>>({});
const selectedCreditsByActivity = reactive<Record<string, string[]>>({});
const creating = ref(false);
const localError = ref("");
const localMessage = ref("");

const selectedMemberCount = computed(() => Object.values(selectedMembersByActivity).reduce((sum, ids) => sum + ids.length, 0));
const selectedCreditCount = computed(() => Object.values(selectedCreditsByActivity).reduce((sum, ids) => sum + ids.length, 0));
const canResign = computed(() => selectedMemberCount.value > 0);
const canIssue = computed(() => selectedMemberCount.value > 0 && selectedCreditCount.value > 0);

async function create(kind: OperationKind) {
  const activitySelections = props.details.map((detail) => {
    const selectedSignUpIds = new Set(selectedMembersByActivity[detail.activityId] ?? []);
    const selectedCreditKeys = new Set(selectedCreditsByActivity[detail.activityId] ?? []);
    return {
      activityId: detail.activityId,
      activityName: detail.activityName,
      members: membersByActivity(detail).filter((member) => member.signUpId && selectedSignUpIds.has(member.signUpId)),
      creditItems: kind === "resign" ? [] : detail.creditItems.filter((item) => selectedCreditKeys.has(creditItemKey(item))),
    };
  }).filter((selection) => selection.members.length > 0 && (kind === "resign" || selection.creditItems.length > 0));

  if (activitySelections.length === 0) {
    localError.value = kind === "resign" ? "请选择要补签的人员。" : "请选择人员和对应活动的学分项。";
    return;
  }

  creating.value = true;
  localError.value = "";
  localMessage.value = "";
  try {
    const plan = await apiPost<OperationPlan>("/api/operation-plans", {
      kind,
      activitySelections,
    });
    localMessage.value = `已生成：${plan.name}`;
    emit("plan-created", plan);
  } catch (error) {
    localError.value = error instanceof Error ? error.message : String(error);
  } finally {
    creating.value = false;
  }
}

function membersByActivity(detail: ActivityDetail): ActivityPersonRow[] {
  const rows = [
    ...Object.values(detail.signLists).flat(),
    ...Object.values(detail.memberLists).flat(),
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
}

function selectAllMembers(detail: ActivityDetail) {
  selectedMembersByActivity[detail.activityId] = membersByActivity(detail)
    .map((member) => member.signUpId)
    .filter((id): id is string => Boolean(id));
}

function selectAllCredits(detail: ActivityDetail) {
  selectedCreditsByActivity[detail.activityId] = detail.creditItems.map(creditItemKey);
}

function clearActivity(activityId: string) {
  selectedMembersByActivity[activityId] = [];
  selectedCreditsByActivity[activityId] = [];
}

function toggleMember(activityId: string, signUpId?: string) {
  if (!signUpId) {
    return;
  }
  selectedMembersByActivity[activityId] = toggleValue(selectedMembersByActivity[activityId] ?? [], signUpId);
}

function toggleCredit(activityId: string, key: string) {
  selectedCreditsByActivity[activityId] = toggleValue(selectedCreditsByActivity[activityId] ?? [], key);
}

function isMemberSelected(activityId: string, signUpId?: string): boolean {
  return Boolean(signUpId && selectedMembersByActivity[activityId]?.includes(signUpId));
}

function isCreditSelected(activityId: string, key: string): boolean {
  return Boolean(selectedCreditsByActivity[activityId]?.includes(key));
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
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
