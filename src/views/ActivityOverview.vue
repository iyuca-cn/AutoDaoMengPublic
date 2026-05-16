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
      <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
    </div>

    <ActivityDetail
      v-if="detail"
      :detail="detail"
      @back="detail = null"
      @refresh="loadDetail(detail.activityId)"
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
        <button type="button" class="text-button" :disabled="selectedIds.length === 0">
          <UserCheck class="h-4 w-4" />
          补签
        </button>
        <button type="button" class="text-button" :disabled="selectedIds.length === 0">
          <BadgeCheck class="h-4 w-4" />
          发放学分
        </button>
        <button type="button" class="text-button" :disabled="selectedIds.length === 0">
          <ListPlus class="h-4 w-4" />
          加入计划
        </button>
        <button type="button" class="danger-button" :disabled="selectedIds.length === 0" title="线上已发学分撤销需要 DMAPI 明确接口">
          <Ban class="h-4 w-4" />
          取消计划发放
        </button>
      </SelectionBar>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { BadgeCheck, Ban, ListPlus, RefreshCw, UserCheck } from "lucide-vue-next";
import { apiGet } from "../api";
import ActivityDetail from "../components/ActivityDetail.vue";
import ActivityTable from "../components/ActivityTable.vue";
import DataToolbar from "../components/DataToolbar.vue";
import SelectionBar from "../components/SelectionBar.vue";
import type { ActivityDetail as ActivityDetailType, ActivityOverviewItem, OperationPlan } from "../types";

const emit = defineEmits<{
  "open-plans": [];
}>();

const items = ref<ActivityOverviewItem[]>([]);
const detail = ref<ActivityDetailType | null>(null);
const loading = ref(false);
const error = ref("");
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

onMounted(load);

async function load() {
  loading.value = true;
  error.value = "";
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
  try {
    detail.value = await apiGet<ActivityDetailType>(`/api/activities/${activityId}`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

function onPlanCreated(_plan: OperationPlan) {
  emit("open-plans");
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
</script>
