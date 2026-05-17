<template>
  <section class="grid gap-4">
    <div class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">执行中心</h2>
          <p class="mt-1 text-sm text-slate-600">执行前会预检签到卡、已发状态和计划可执行性。</p>
        </div>
        <button class="primary-button" type="button" @click="load">
          <RefreshCw class="h-4 w-4" />
          刷新
        </button>
      </div>
      <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
    </div>

    <div class="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <aside class="panel p-3">
        <label class="grid gap-1">
          <span class="label">选择计划</span>
          <select class="field" v-model="selectedPlanId">
            <option value="">请选择</option>
            <option v-for="plan in executablePlans" :key="plan.key" :value="plan.key">
              {{ plan.label }} · {{ plan.status }}
            </option>
          </select>
        </label>
        <div class="mt-3 grid gap-2">
          <button class="text-button justify-center" type="button" :disabled="!selectedPlanId || running" @click="runPrecheck">
            <ShieldCheck class="h-4 w-4" />
            运行预检
          </button>
          <button class="danger-button justify-center" type="button" :disabled="!canExecute" @click="execute">
            <PlayCircle class="h-4 w-4" />
            {{ selectedPlan?.status === "failed" ? "重新执行" : "确认执行" }}
          </button>
        </div>
        <div v-if="streamMessages.length > 0" class="mt-3 grid gap-1 rounded border border-line bg-paper p-2 text-xs text-slate-600">
          <div v-for="(item, index) in streamMessages" :key="`${index}-${item}`">{{ item }}</div>
        </div>
      </aside>

      <article class="grid gap-4">
        <ExecutionPrecheck v-if="precheck" :report="precheck" />
        <div v-if="task" class="panel p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="font-semibold">任务 {{ task.id }}</h3>
            <button class="text-button" type="button" :disabled="downloadingTaskId === task.id" @click="downloadExecutionReport(task)">
              <Download class="h-4 w-4" />
              导出个人执行明细
            </button>
          </div>
          <ExecutionResults class="mt-4" :task="task" />
          <ExecutionProgress class="mt-4" :task="task" />
        </div>
        <div v-if="lastFailedTask && !task" class="panel p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="font-semibold">上次失败任务 {{ lastFailedTask.id }}</h3>
              <p class="mt-1 text-sm text-slate-600">可导出已完成详情，以及计划中剩余未完成部分。</p>
            </div>
            <button class="text-button" type="button" :disabled="downloadingTaskId === lastFailedTask.id" @click="downloadExecutionReport(lastFailedTask)">
              <Download class="h-4 w-4" />
              导出失败计划详情
            </button>
          </div>
          <ExecutionResults class="mt-4" :task="lastFailedTask" />
          <ExecutionProgress class="mt-4" :task="lastFailedTask" />
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Download, PlayCircle, RefreshCw, ShieldCheck } from "lucide-vue-next";
import { apiGet, apiStream, downloadFile } from "../api";
import ExecutionPrecheck from "../components/ExecutionPrecheck.vue";
import ExecutionProgress from "../components/ExecutionProgress.vue";
import ExecutionResults from "../components/ExecutionResults.vue";
import type { ApiStreamEvent, ExecutionTask, OperationPlan, Plan } from "../types";

const plans = ref<Plan[]>([]);
const operationPlans = ref<OperationPlan[]>([]);
const tasks = ref<ExecutionTask[]>([]);
const selectedPlanId = ref("");
const precheck = ref<{ executable: boolean; actionCount: number; issues: Array<{ level: string; code: string; message: string }> } | null>(null);
const precheckedPlanKey = ref("");
const task = ref<ExecutionTask | null>(null);
const running = ref(false);
const downloadingTaskId = ref("");
const error = ref("");
const streamMessages = ref<string[]>([]);

type ExecutablePlanOption = { key: string; id: string; type: "credit" | "operation"; label: string; status: string };
type PrecheckReport = { executable: boolean; actionCount: number; issues: Array<{ level: string; code: string; message: string }> };

const executablePlans = computed<ExecutablePlanOption[]>(() => [
  ...plans.value
    .filter((plan) => ["draft", "ready", "failed"].includes(plan.status))
    .map((plan) => ({ key: `credit:${plan.id}`, id: plan.id, type: "credit" as const, label: `Excel · ${plan.name}`, status: plan.status })),
  ...operationPlans.value
    .filter((plan) => ["draft", "ready", "failed"].includes(plan.status))
    .map((plan) => ({ key: `operation:${plan.id}`, id: plan.id, type: "operation" as const, label: `操作 · ${plan.name}`, status: plan.status })),
]);
const selectedPlan = computed(() => executablePlans.value.find((plan) => plan.key === selectedPlanId.value) ?? null);
const lastFailedTask = computed(() => {
  const plan = selectedPlan.value;
  if (!plan || plan.status !== "failed") {
    return null;
  }
  return tasks.value
    .filter((item) => item.status === "failed" && (item.targetId ?? item.planId) === plan.id && taskTypeMatches(item, plan.type))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
});
const canExecute = computed(() => Boolean(
  selectedPlan.value
    && precheck.value?.executable
    && precheckedPlanKey.value === selectedPlan.value.key
    && !running.value,
));

onMounted(load);

watch(selectedPlanId, () => {
  precheck.value = null;
  precheckedPlanKey.value = "";
  task.value = null;
  streamMessages.value = [];
});

async function load() {
  error.value = "";
  try {
    const [credit, operation, allTasks] = await Promise.all([
      apiGet<Plan[]>("/api/plans"),
      apiGet<OperationPlan[]>("/api/operation-plans"),
      apiGet<ExecutionTask[]>("/api/tasks"),
    ]);
    plans.value = credit;
    operationPlans.value = operation;
    tasks.value = allTasks;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function runPrecheck() {
  if (!selectedPlan.value) {
    return;
  }
  running.value = true;
  error.value = "";
  streamMessages.value = [];
  try {
    const path = selectedPlan.value.type === "operation"
      ? `/api/operation-plans/${selectedPlan.value.id}/precheck/stream`
      : `/api/plans/${selectedPlan.value.id}/precheck/stream`;
    precheck.value = await apiStream<PrecheckReport>(path, {
      method: "POST",
      onEvent: appendStreamMessage,
    });
    precheckedPlanKey.value = selectedPlan.value.key;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    running.value = false;
  }
}

async function execute() {
  if (!canExecute.value || !selectedPlan.value) {
    return;
  }
  if (!confirmExecution(selectedPlan.value)) {
    return;
  }
  running.value = true;
  error.value = "";
  streamMessages.value = [];
  try {
    const path = selectedPlan.value.type === "operation"
      ? `/api/operation-plans/${selectedPlan.value.id}/execute/stream`
      : `/api/plans/${selectedPlan.value.id}/execute/stream`;
    task.value = await apiStream<ExecutionTask>(path, {
      method: "POST",
      onEvent: (event) => {
        appendStreamMessage(event);
        if (event.type === "task" && isTask(event.data)) {
          task.value = event.data;
        }
      },
    });
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    running.value = false;
  }
}

async function downloadExecutionReport(targetTask: ExecutionTask) {
  downloadingTaskId.value = targetTask.id;
  error.value = "";
  try {
    await downloadFile(`/api/tasks/${targetTask.id}/reports/execution.xlsx`, `${targetTask.id}-execution.xlsx`);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    downloadingTaskId.value = "";
  }
}

function confirmExecution(plan: ExecutablePlanOption): boolean {
  const action = plan.status === "failed" ? "重新执行" : "执行";
  const firstConfirmed = window.confirm(`确认${action}「${plan.label}」？`);
  if (!firstConfirmed) {
    return false;
  }
  return window.confirm("再次确认：执行会提交线上写操作，是否继续？");
}

function appendStreamMessage(event: ApiStreamEvent<unknown>) {
  if (!event.message) {
    return;
  }
  streamMessages.value = [...streamMessages.value.slice(-7), event.message];
}

function isTask(value: unknown): value is ExecutionTask {
  return typeof value === "object" && value !== null && "id" in value && "events" in value;
}

function taskTypeMatches(targetTask: ExecutionTask, type: ExecutablePlanOption["type"]): boolean {
  if (type === "operation") {
    return targetTask.targetType === "operationPlan";
  }
  return targetTask.targetType === "creditPlan" || targetTask.targetType === undefined;
}
</script>
