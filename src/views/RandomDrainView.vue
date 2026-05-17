<template>
  <section class="grid gap-4">
    <div class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">随机消耗</h2>
          <p class="mt-1 text-sm text-slate-600">选择活动学分包后，按阈值和偏移生成随机发放预览。</p>
        </div>
        <button class="primary-button" type="button" :disabled="loading" @click="loadActivities">
          <RefreshCw class="h-4 w-4" />
          刷新活动
        </button>
      </div>
      <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="preview">
        <label class="grid gap-1">
          <span class="label">阈值百分比</span>
          <input class="field w-32" v-model.number="thresholdPercent" type="number" min="0" max="100" />
        </label>
        <label class="grid gap-1">
          <span class="label">偏移人数</span>
          <input class="field w-28" v-model.number="jitterCount" type="number" min="0" />
        </label>
        <button class="primary-button" type="submit" :disabled="loading || selectedItems.length === 0">
          <Shuffle class="h-4 w-4" />
          生成预览
        </button>
        <button v-if="batch" class="text-button" type="button" :disabled="downloading" @click="downloadPreview">
          <Download class="h-4 w-4" />
          导出预览
        </button>
      </form>
      <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
      <p v-if="message" class="mt-3 rounded border border-moss/30 bg-mint px-3 py-2 text-sm text-moss">{{ message }}</p>
    </div>

    <div class="grid gap-4 lg:grid-cols-[minmax(22rem,28rem)_1fr]">
      <aside class="panel overflow-hidden">
        <div class="border-b border-line p-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="font-semibold">活动学分包</h3>
            <span class="text-xs text-slate-500">已选 {{ selectedItems.length }}</span>
          </div>
          <input class="field mt-3" v-model.trim="keyword" placeholder="筛选活动或学分类型" />
        </div>
        <div class="max-h-[34rem] overflow-auto">
          <div v-if="filteredActivities.length === 0" class="p-4 text-sm text-slate-500">暂无可选活动学分包</div>
          <div v-for="activity in filteredActivities" :key="activity.activityId" class="border-b border-line p-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="font-medium">{{ activity.activityName }}</div>
                <div class="mt-1 text-xs text-slate-500">{{ activity.activityId }} · {{ activity.hasSignCard ? "有签到卡" : "无签到卡" }}</div>
              </div>
              <button class="text-button px-2 py-1 text-xs" type="button" @click="toggleActivity(activity)">
                {{ isActivityFullySelected(activity) ? "清空" : "全选" }}
              </button>
            </div>
            <div class="mt-3 grid gap-2">
              <label
                v-for="item in activity.creditItems"
                :key="`${activity.activityId}:${item.creditId}`"
                class="flex items-center gap-2 rounded border border-line bg-paper px-2 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  :checked="isSelected(activity.activityId, item.creditId)"
                  @change="toggleCredit(activity.activityId, item.creditId)"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{{ item.creditType }} {{ formatCent(item.unitcountCent) }}</span>
                  <span class="block truncate text-xs text-slate-500">creditId {{ item.creditId }} · 剩余 {{ item.remainingCapacity }}</span>
                </span>
              </label>
            </div>
          </div>
        </div>
      </aside>

      <article class="grid gap-4">
        <div v-if="batch" class="panel p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="font-semibold">预览 {{ batch.id }}</h3>
              <p class="mt-1 text-sm text-slate-600">
                活动 {{ batch.summary.activityCount }} 个，学分包 {{ batch.summary.creditItemCount }} 个，计划发放 {{ batch.summary.plannedIssueCount }} 人次。
              </p>
            </div>
            <button class="danger-button" type="button" :disabled="!canExecute" @click="execute">
              <PlayCircle class="h-4 w-4" />
              确认执行
            </button>
          </div>
          <div class="mt-4 grid gap-3">
            <div v-for="activity in batch.activities" :key="activity.activityId" class="rounded border border-line bg-paper p-3">
              <label class="flex items-center justify-between gap-3">
                <span>
                  <span class="font-medium">{{ activity.activityName }}</span>
                  <span class="ml-2 text-xs text-slate-500">{{ activity.activityId }} · 本次 {{ activity.plannedIssueCount }}</span>
                </span>
                <input type="checkbox" :disabled="activity.plannedIssueCount === 0" :checked="confirmedActivityIds.includes(activity.activityId)" @change="toggleConfirmedActivity(activity.activityId)" />
              </label>
              <div class="mt-3 overflow-x-auto">
                <table class="min-w-full text-left text-sm">
                  <thead class="text-xs text-slate-500">
                    <tr>
                      <th class="px-2 py-1">学分包</th>
                      <th class="px-2 py-1">已发/目标</th>
                      <th class="px-2 py-1">偏移</th>
                      <th class="px-2 py-1">候选</th>
                      <th class="px-2 py-1">本次</th>
                      <th class="px-2 py-1">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="selection in activity.selections" :key="`${selection.activityId}:${selection.creditId}`" class="border-t border-line">
                      <td class="px-2 py-2">{{ selection.creditType || "-" }} {{ selection.unitcountCent ? formatCent(selection.unitcountCent) : "" }}</td>
                      <td class="px-2 py-2">{{ selection.providedCount }} / {{ selection.finalTargetCount }}</td>
                      <td class="px-2 py-2">{{ selection.jitterOffset }}</td>
                      <td class="px-2 py-2">{{ selection.candidateCount }}</td>
                      <td class="px-2 py-2">{{ selection.plannedIssueCount }}</td>
                      <td class="px-2 py-2">{{ statusLabel(selection.status) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div v-if="task" class="panel p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="font-semibold">执行任务 {{ task.id }}</h3>
            <button class="text-button" type="button" :disabled="downloading" @click="downloadTask(task)">
              <Download class="h-4 w-4" />
              导出执行明细
            </button>
          </div>
          <ExecutionResults class="mt-4" :task="task" />
          <ExecutionProgress class="mt-4" :task="task" />
        </div>

        <div v-if="randomDrainTasks.length > 0" class="panel overflow-hidden">
          <div class="border-b border-line p-4">
            <h3 class="font-semibold">历史随机消耗任务</h3>
            <p class="mt-1 text-sm text-slate-600">刷新后仍可导出已执行任务的个人明细。</p>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="bg-paper text-xs text-slate-500">
                <tr>
                  <th class="px-3 py-2">任务</th>
                  <th class="px-3 py-2">状态</th>
                  <th class="px-3 py-2">更新时间</th>
                  <th class="px-3 py-2">成功/失败</th>
                  <th class="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in randomDrainTasks" :key="item.id" class="border-t border-line">
                  <td class="px-3 py-2 font-mono text-xs">{{ item.id }}</td>
                  <td class="px-3 py-2">{{ item.status }}</td>
                  <td class="px-3 py-2">{{ formatUserDateTime(item.updatedAt) }}</td>
                  <td class="px-3 py-2">发放 {{ item.result?.issueSuccessCount ?? 0 }}，失败 {{ item.result?.failedCount ?? 0 }}</td>
                  <td class="px-3 py-2">
                    <button class="text-button" type="button" :disabled="downloading" @click="downloadTask(item)">
                      <Download class="h-4 w-4" />
                      导出
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Download, PlayCircle, RefreshCw, Shuffle } from "lucide-vue-next";
import { apiGet, apiPost, apiStream, downloadFile } from "../api";
import ExecutionProgress from "../components/ExecutionProgress.vue";
import ExecutionResults from "../components/ExecutionResults.vue";
import type { ActivityOverviewItem, ApiStreamEvent, ExecutionTask, RandomDrainBatch } from "../types";
import { formatCent } from "../types";
import { formatUserDateTime } from "../time";

const activities = ref<ActivityOverviewItem[]>([]);
const tasks = ref<ExecutionTask[]>([]);
const selectedKeys = ref<string[]>([]);
const thresholdPercent = ref(90);
const jitterCount = ref(0);
const keyword = ref("");
const batch = ref<RandomDrainBatch | null>(null);
const confirmedActivityIds = ref<string[]>([]);
const task = ref<ExecutionTask | null>(null);
const loading = ref(false);
const downloading = ref(false);
const error = ref("");
const message = ref("");

const filteredActivities = computed(() => {
  const text = keyword.value.trim();
  return activities.value.filter((activity) => {
    if (activity.creditItems.length === 0) {
      return false;
    }
    if (!text) {
      return true;
    }
    return activity.activityId.includes(text)
      || activity.activityName.includes(text)
      || activity.creditItems.some((item) => item.creditType.includes(text) || item.creditId.includes(text));
  });
});
const selectedItems = computed(() => selectedKeys.value.map((key) => {
  const [activityId, creditId] = key.split(":");
  return { activityId, creditId };
}));
const canExecute = computed(() => Boolean(batch.value && confirmedActivityIds.value.length > 0 && !loading.value));
const randomDrainTasks = computed(() => tasks.value
  .filter((item) => item.targetType === "randomDrain")
  .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));

onMounted(loadActivities);

async function loadActivities() {
  loading.value = true;
  error.value = "";
  message.value = "";
  try {
    activities.value = await apiGet<ActivityOverviewItem[]>("/api/activities");
    tasks.value = await apiGet<ExecutionTask[]>("/api/tasks");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function preview() {
  loading.value = true;
  error.value = "";
  message.value = "";
  task.value = null;
  try {
    batch.value = await apiPost<RandomDrainBatch>("/api/random-drain/preview", {
      thresholdPercent: thresholdPercent.value,
      jitterCount: jitterCount.value,
      selectedItems: selectedItems.value,
    });
    confirmedActivityIds.value = batch.value.activities.filter((activity) => activity.plannedIssueCount > 0).map((activity) => activity.activityId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function execute() {
  if (!batch.value || confirmedActivityIds.value.length === 0) {
    return;
  }
  if (!window.confirm(`确认执行 ${confirmedActivityIds.value.length} 个活动的随机消耗？`)) {
    return;
  }
  loading.value = true;
  error.value = "";
  message.value = "";
  try {
    task.value = await apiStream<ExecutionTask>(`/api/random-drain/batches/${batch.value.id}/execute/stream`, {
      method: "POST",
      body: { confirmedActivityIds: confirmedActivityIds.value },
      onEvent: (event: ApiStreamEvent<ExecutionTask>) => {
        if (event.message) {
          message.value = event.message;
        }
        if (event.type === "task" && isTask(event.data)) {
          task.value = event.data;
        }
      },
    });
    await refreshTasks();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function refreshTasks() {
  tasks.value = await apiGet<ExecutionTask[]>("/api/tasks");
}

async function downloadPreview() {
  if (!batch.value) {
    return;
  }
  downloading.value = true;
  try {
    await downloadFile(`/api/random-drain/batches/${batch.value.id}/reports/preview.xlsx`, `${batch.value.id}-random-drain-preview.xlsx`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    downloading.value = false;
  }
}

async function downloadTask(targetTask: ExecutionTask) {
  downloading.value = true;
  try {
    await downloadFile(`/api/tasks/${targetTask.id}/reports/execution.xlsx`, `${targetTask.id}-execution.xlsx`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    downloading.value = false;
  }
}

function toggleActivity(activity: ActivityOverviewItem) {
  const keys = activity.creditItems.map((item) => selectionKey(activity.activityId, item.creditId));
  if (keys.every((key) => selectedKeys.value.includes(key))) {
    selectedKeys.value = selectedKeys.value.filter((key) => !keys.includes(key));
    return;
  }
  selectedKeys.value = [...new Set([...selectedKeys.value, ...keys])];
}

function toggleCredit(activityId: string, creditId: string) {
  const key = selectionKey(activityId, creditId);
  selectedKeys.value = selectedKeys.value.includes(key)
    ? selectedKeys.value.filter((item) => item !== key)
    : [...selectedKeys.value, key];
}

function toggleConfirmedActivity(activityId: string) {
  confirmedActivityIds.value = confirmedActivityIds.value.includes(activityId)
    ? confirmedActivityIds.value.filter((id) => id !== activityId)
    : [...confirmedActivityIds.value, activityId];
}

function isSelected(activityId: string, creditId: string): boolean {
  return selectedKeys.value.includes(selectionKey(activityId, creditId));
}

function isActivityFullySelected(activity: ActivityOverviewItem): boolean {
  return activity.creditItems.length > 0 && activity.creditItems.every((item) => isSelected(activity.activityId, item.creditId));
}

function selectionKey(activityId: string, creditId: string): string {
  return `${activityId}:${creditId}`;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    ready: "待执行",
    threshold_reached: "已达阈值",
    no_candidates: "无候选人",
    candidate_shortage: "候选不足",
    no_sign_card: "无签到卡",
    missing_credit_item: "学分包不存在",
  };
  return labels[status] ?? status;
}

function isTask(value: unknown): value is ExecutionTask {
  return typeof value === "object" && value !== null && "id" in value && "events" in value;
}
</script>
