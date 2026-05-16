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
          <label class="grid gap-1">
            <span class="label">确认文本</span>
            <input class="field" v-model="confirmText" :placeholder="`输入 ${requiredConfirmText}`" />
          </label>
          <button class="danger-button justify-center" type="button" :disabled="!canExecute" @click="execute">
            <PlayCircle class="h-4 w-4" />
            确认执行
          </button>
        </div>
      </aside>

      <article class="grid gap-4">
        <ExecutionPrecheck v-if="precheck" :report="precheck" />
        <div v-if="task" class="panel p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="font-semibold">任务 {{ task.id }}</h3>
            <a class="text-button" :href="downloadUrl(`/api/tasks/${task.id}/reports/execution.xlsx`)">
              <Download class="h-4 w-4" />
              导出结果
            </a>
          </div>
          <ExecutionResults class="mt-4" :task="task" />
          <ExecutionProgress class="mt-4" :task="task" />
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Download, PlayCircle, RefreshCw, ShieldCheck } from "lucide-vue-next";
import { apiGet, apiPost, downloadUrl } from "../api";
import ExecutionPrecheck from "../components/ExecutionPrecheck.vue";
import ExecutionProgress from "../components/ExecutionProgress.vue";
import ExecutionResults from "../components/ExecutionResults.vue";
import type { ExecutionTask, OperationPlan, Plan } from "../types";

const plans = ref<Plan[]>([]);
const operationPlans = ref<OperationPlan[]>([]);
const selectedPlanId = ref("");
const precheck = ref<{ executable: boolean; actionCount: number; issues: Array<{ level: string; code: string; message: string }> } | null>(null);
const task = ref<ExecutionTask | null>(null);
const confirmText = ref("");
const running = ref(false);
const error = ref("");

type ExecutablePlanOption = { key: string; id: string; type: "credit" | "operation"; label: string; status: string };

const executablePlans = computed<ExecutablePlanOption[]>(() => [
  ...plans.value
    .filter((plan) => ["draft", "ready"].includes(plan.status))
    .map((plan) => ({ key: `credit:${plan.id}`, id: plan.id, type: "credit" as const, label: `Excel · ${plan.name}`, status: plan.status })),
  ...operationPlans.value
    .filter((plan) => ["draft", "ready"].includes(plan.status))
    .map((plan) => ({ key: `operation:${plan.id}`, id: plan.id, type: "operation" as const, label: `操作 · ${plan.name}`, status: plan.status })),
]);
const selectedPlan = computed(() => executablePlans.value.find((plan) => plan.key === selectedPlanId.value) ?? null);
const requiredConfirmText = computed(() => selectedPlan.value?.type === "operation" ? "执行操作计划" : "执行计划");
const canExecute = computed(() => Boolean(selectedPlan.value && precheck.value?.executable && confirmText.value === requiredConfirmText.value && !running.value));

onMounted(load);

async function load() {
  error.value = "";
  try {
    const [credit, operation] = await Promise.all([
      apiGet<Plan[]>("/api/plans"),
      apiGet<OperationPlan[]>("/api/operation-plans"),
    ]);
    plans.value = credit;
    operationPlans.value = operation;
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
  try {
    const path = selectedPlan.value.type === "operation"
      ? `/api/operation-plans/${selectedPlan.value.id}/precheck`
      : `/api/plans/${selectedPlan.value.id}/precheck`;
    precheck.value = await apiPost(path);
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
  running.value = true;
  error.value = "";
  try {
    const path = selectedPlan.value.type === "operation"
      ? `/api/operation-plans/${selectedPlan.value.id}/execute`
      : `/api/plans/${selectedPlan.value.id}/execute`;
    const body = selectedPlan.value.type === "operation" ? { confirmText: "执行操作计划" } : undefined;
    task.value = await apiPost<ExecutionTask>(path, body);
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    running.value = false;
  }
}
</script>
