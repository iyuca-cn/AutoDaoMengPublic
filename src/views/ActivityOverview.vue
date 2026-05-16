<template>
  <section class="grid gap-4">
    <div class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">活动总览</h2>
          <p class="mt-1 text-sm text-slate-600">按活动、签到状态和学分项查看当前可管理活动。</p>
        </div>
        <button class="primary-button" type="button" :disabled="loading" @click="load">
          <RefreshCw class="h-4 w-4" />
          刷新活动
        </button>
      </div>
      <div class="mt-4">
        <DataToolbar v-model="filters" :filters="filterConfigs" @refresh="load" />
      </div>
      <p v-if="message" class="mt-3 rounded border border-moss/30 bg-mint px-3 py-2 text-sm text-moss">{{ message }}</p>
      <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
    </div>

    <ActivityDetail
      v-if="detail"
      :detail="detail"
      @back="detail = null"
      @refresh="loadDetail(detail.activityId)"
      @plan-created="onPlanCreated"
    />
    <MultiActivityDetail
      v-else-if="multiDetailOpen"
      :details="multiDetails"
      :errors="multiErrors"
      :loading="loading"
      :progress-message="streamMessage"
      @back="closeMultiDetail"
      @refresh="loadMultiDetails"
      @plan-created="onPlanCreated"
    />

    <div v-else class="panel overflow-hidden">
      <ActivityTable :items="filteredItems" :selected-ids="selectedIds" @toggle="toggle" @open="loadDetail" />
      <SelectionBar
        :selected-count="selectedIds.length"
        @select-all="selectAll"
        @invert="invert"
        @clear="selectedIds = []"
      >
        <button type="button" class="text-button" :disabled="!canUseSelectedActivities || loading" @click="openSelectedActivity">
          <FileSearch class="h-4 w-4" />
          查看详情
        </button>
        <button type="button" class="text-button" :disabled="!canUseSelectedActivities || loading" @click="openSelectedActivity">
          <UserCheck class="h-4 w-4" />
          补签
        </button>
        <button type="button" class="text-button" :disabled="!canUseSelectedActivities || loading" @click="openSelectedActivity">
          <BadgeCheck class="h-4 w-4" />
          发放学分
        </button>
        <button type="button" class="text-button" :disabled="!canUseSelectedActivities || loading" @click="openSelectedActivity">
          <ListPlus class="h-4 w-4" />
          加入计划
        </button>
        <button type="button" class="danger-button" :disabled="!canUseSelectedActivities || loading" @click="cancelPlannedIssues" title="只取消未执行操作计划中的待发动作，不撤销线上已发学分">
          <Ban class="h-4 w-4" />
          取消计划发放
        </button>
      </SelectionBar>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { BadgeCheck, Ban, FileSearch, ListPlus, RefreshCw, UserCheck } from "lucide-vue-next";
import { apiGet, apiPatch, apiStream } from "../api";
import ActivityDetail from "../components/ActivityDetail.vue";
import ActivityTable from "../components/ActivityTable.vue";
import DataToolbar from "../components/DataToolbar.vue";
import MultiActivityDetail from "../components/MultiActivityDetail.vue";
import SelectionBar from "../components/SelectionBar.vue";
import type { ActivityDetail as ActivityDetailType, ActivityOverviewItem, ApiStreamEvent, OperationAction, OperationPlan } from "../types";

const emit = defineEmits<{
  "open-plans": [plan?: OperationPlan];
}>();

const items = ref<ActivityOverviewItem[]>([]);
const detail = ref<ActivityDetailType | null>(null);
const multiDetailOpen = ref(false);
const multiDetails = ref<ActivityDetailType[]>([]);
const multiErrors = ref<Array<{ activityId: string; message: string }>>([]);
const loading = ref(false);
const error = ref("");
const message = ref("");
const streamMessage = ref("");
const selectedIds = ref<string[]>([]);
const filters = ref<Record<string, string>>({
  activity: "",
  activityId: "",
  creditType: "",
  signCard: "",
});

const filterConfigs = [
  { key: "activity", label: "活动名" },
  { key: "activityId", label: "活动 ID" },
  { key: "creditType", label: "学分类型" },
  { key: "signCard", label: "签到卡", type: "select" as const, options: ["有", "无"] },
];

const filteredItems = computed(() => {
  return items.value.filter((item) => {
    const activityMatch = item.activityName.includes(filters.value.activity || "");
    const idMatch = item.activityId.includes(filters.value.activityId || "");
    const creditMatch = !filters.value.creditType || item.creditItems.some((credit) => credit.creditType.includes(filters.value.creditType));
    const signCardMatch = !filters.value.signCard || (filters.value.signCard === "有" ? item.hasSignCard : !item.hasSignCard);
    return activityMatch && idMatch && creditMatch && signCardMatch;
  });
});
const effectiveSelectedIds = computed(() => selectedIds.value.length > 0 ? selectedIds.value : filteredItems.value.map((item) => item.activityId));
const canUseSelectedActivities = computed(() => effectiveSelectedIds.value.length > 0);

onMounted(load);

async function load() {
  loading.value = true;
  error.value = "";
  message.value = "";
  try {
    items.value = await apiGet<ActivityOverviewItem[]>("/api/activities");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function loadDetail(activityId: string) {
  loading.value = true;
  error.value = "";
  message.value = "";
  streamMessage.value = "";
  try {
    detail.value = await apiStream<ActivityDetailType>(`/api/activities/${activityId}/stream`, {
      onEvent: (event) => {
        streamMessage.value = event.message || streamMessage.value;
      },
    });
    multiDetailOpen.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function onPlanCreated(plan: OperationPlan) {
  emit("open-plans", plan);
}

async function openSelectedActivity() {
  if (effectiveSelectedIds.value.length === 0) {
    return;
  }
  message.value = "";
  if (effectiveSelectedIds.value.length > 1) {
    await loadMultiDetails();
    return;
  }
  const activityId = effectiveSelectedIds.value[0];
  await loadDetail(activityId);
}

async function loadMultiDetails() {
  const activityIds = effectiveSelectedIds.value;
  if (activityIds.length === 0) {
    return;
  }
  loading.value = true;
  error.value = "";
  message.value = "";
  streamMessage.value = "";
  detail.value = null;
  multiDetailOpen.value = true;
  multiDetails.value = [];
  multiErrors.value = [];
  try {
    const result = await apiStream<{ details: ActivityDetailType[]; errors: Array<{ activityId: string; message: string }> }>("/api/activities/details/stream", {
      method: "POST",
      body: { activityIds },
      nonFatalErrorCodes: ["ACTIVITY_DETAIL_FAILED"],
      onEvent: (event: ApiStreamEvent<ActivityDetailType | { activityId: string; message: string } | { details: ActivityDetailType[]; errors: Array<{ activityId: string; message: string }> }>) => {
        streamMessage.value = event.message || streamMessage.value;
        if (event.type === "data" && isActivityDetail(event.data)) {
          multiDetails.value = upsertDetail(multiDetails.value, event.data);
        }
        if (event.type === "error" && isActivityError(event.data)) {
          multiErrors.value = upsertError(multiErrors.value, event.data);
        }
      },
    });
    multiDetails.value = result.details;
    multiErrors.value = result.errors;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function closeMultiDetail() {
  multiDetailOpen.value = false;
  multiDetails.value = [];
  multiErrors.value = [];
  streamMessage.value = "";
}

async function cancelPlannedIssues() {
  const activityIds = new Set(effectiveSelectedIds.value);
  if (activityIds.size === 0) {
    return;
  }
  loading.value = true;
  error.value = "";
  message.value = "";
  try {
    const plans = await apiGet<OperationPlan[]>("/api/operation-plans");
    const editablePlans = plans.filter((plan) => planActivityIds(plan).some((activityId) => activityIds.has(activityId)) && ["draft", "ready"].includes(plan.status));
    let changedPlanCount = 0;
    let changedActionCount = 0;
    for (const plan of editablePlans) {
      const result = cancelIssueActions(plan.actions);
      if (result.changedCount === 0) {
        continue;
      }
      changedPlanCount += 1;
      changedActionCount += result.changedCount;
      await apiPatch<OperationPlan>(`/api/operation-plans/${plan.id}`, { actions: result.actions });
    }
    if (changedActionCount === 0) {
      message.value = "当前选择活动没有可取消的未执行计划发放动作。";
      return;
    }
    message.value = `已在 ${changedPlanCount} 个操作计划中取消 ${changedActionCount} 条待发放动作。`;
    emit("open-plans");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function toggle(activityId: string) {
  selectedIds.value = selectedIds.value.includes(activityId)
    ? selectedIds.value.filter((id) => id !== activityId)
    : [...selectedIds.value, activityId];
}

function selectAll() {
  selectedIds.value = [...new Set([...selectedIds.value, ...filteredItems.value.map((item) => item.activityId)])];
}

function invert() {
  const filteredIds = new Set(filteredItems.value.map((item) => item.activityId));
  const selected = new Set(selectedIds.value);
  for (const id of filteredIds) {
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
  }
  selectedIds.value = [...selected];
}

function cancelIssueActions(actions: OperationAction[]): { actions: OperationAction[]; changedCount: number } {
  let changedCount = 0;
  const nextActions = actions.map((action) => {
    if (!action.enabled || !["issueCredit", "resignThenIssueCredit"].includes(action.kind)) {
      return action;
    }
    changedCount += 1;
    if (action.kind === "resignThenIssueCredit") {
      return {
        ...action,
        kind: "resign" as const,
        creditItems: [],
        note: appendNote(action.note, "已取消计划发放"),
      };
    }
    return {
      ...action,
      enabled: false,
      status: "disabled" as const,
      note: appendNote(action.note, "已取消计划发放"),
    };
  });
  return { actions: nextActions, changedCount };
}

function appendNote(note: string | undefined, value: string): string {
  return note ? `${note}；${value}` : value;
}

function planActivityIds(plan: OperationPlan): string[] {
  return plan.activityIds?.length ? plan.activityIds : [plan.activityId];
}

function upsertDetail(details: ActivityDetailType[], detail: ActivityDetailType): ActivityDetailType[] {
  return [...details.filter((item) => item.activityId !== detail.activityId), detail];
}

function upsertError(errors: Array<{ activityId: string; message: string }>, error: { activityId: string; message: string }) {
  return [...errors.filter((item) => item.activityId !== error.activityId), error];
}

function isActivityDetail(value: unknown): value is ActivityDetailType {
  return typeof value === "object" && value !== null && "activityId" in value && "signLists" in value;
}

function isActivityError(value: unknown): value is { activityId: string; message: string } {
  return typeof value === "object" && value !== null && "activityId" in value && "message" in value;
}
</script>
