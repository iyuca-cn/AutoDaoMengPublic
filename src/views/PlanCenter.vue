<template>
  <section class="grid gap-4">
    <div class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">计划中心</h2>
          <p class="mt-1 text-sm text-slate-600">查看、编辑未执行计划，已执行计划需复制后再调整。</p>
        </div>
        <button class="primary-button" type="button" @click="load">
          <RefreshCw class="h-4 w-4" />
          刷新计划
        </button>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button class="text-button" :class="planType === 'credit' ? 'border-moss bg-mint text-moss' : ''" type="button" @click="setPlanType('credit')">
          Excel 学分计划
        </button>
        <button class="text-button" :class="planType === 'operation' ? 'border-moss bg-mint text-moss' : ''" type="button" @click="setPlanType('operation')">
          活动操作计划
        </button>
      </div>
      <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
    </div>

    <div v-if="planType === 'credit'" class="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <aside class="panel p-3">
        <div class="grid gap-2">
          <button
            v-for="plan in plans"
            :key="plan.id"
            type="button"
            class="text-left rounded border border-line bg-white px-3 py-2 hover:border-moss"
            :class="selectedPlan?.id === plan.id ? 'border-moss bg-mint' : ''"
            @click="select(plan)"
          >
            <div class="font-medium">{{ plan.name }}</div>
            <div class="mt-1 text-xs text-slate-500">{{ statusLabel(plan.status) }} · {{ plan.summary.plannedIssueCount }} 项</div>
          </button>
          <p v-if="plans.length === 0" class="text-sm text-slate-500">暂无计划</p>
        </div>
      </aside>

      <article v-if="selectedPlan" class="panel p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-base font-semibold">{{ selectedPlan.name }}</h3>
            <p class="mt-1 text-sm text-slate-600">{{ statusLabel(selectedPlan.status) }} · {{ selectedPlan.generatedAt }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <a class="text-button" :href="downloadUrl(`/api/plans/${selectedPlan.id}/reports/summary.xlsx`)">
              <Download class="h-4 w-4" />
              导出摘要
            </a>
            <button class="primary-button" type="button" :disabled="saving" @click="savePlan">
              <Save class="h-4 w-4" />
              保存修改
            </button>
          </div>
        </div>
        <PlanSummary class="mt-4" :plan="selectedPlan" />
        <div class="mt-4 flex flex-wrap gap-2">
          <button v-for="mode in modes" :key="mode.key" class="text-button" :class="viewMode === mode.key ? 'border-moss bg-mint text-moss' : ''" type="button" @click="viewMode = mode.key">
            {{ mode.label }}
          </button>
        </div>
        <div class="mt-4">
          <PlanAllocationTable v-if="viewMode === 'allocations'" v-model="editableAllocations" />
          <PlanStudentView v-else-if="viewMode === 'students'" :plan="selectedPlan" />
          <PlanActivityView v-else-if="viewMode === 'activities'" :plan="selectedPlan" />
          <div v-else class="grid gap-2">
            <div v-for="item in selectedPlan.notInAdmitList" :key="`${item.studentId}-${item.creditType}`" class="rounded border border-line bg-paper p-3 text-sm">
              {{ item.studentName }} {{ item.studentId }} 不在 {{ item.creditType }} 可用活动录取名单
            </div>
            <p v-if="selectedPlan.notInAdmitList.length === 0" class="text-sm text-slate-500">没有异常记录</p>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <aside class="panel p-3">
        <div class="grid gap-2">
          <button
            v-for="plan in operationPlans"
            :key="plan.id"
            type="button"
            class="text-left rounded border border-line bg-white px-3 py-2 hover:border-moss"
            :class="selectedOperationPlan?.id === plan.id ? 'border-moss bg-mint' : ''"
            @click="selectOperation(plan)"
          >
            <div class="font-medium">{{ plan.name }}</div>
            <div class="mt-1 text-xs text-slate-500">{{ statusLabel(plan.status) }} · {{ plan.summary.enabledCount }} 项</div>
          </button>
          <p v-if="operationPlans.length === 0" class="text-sm text-slate-500">暂无活动操作计划</p>
        </div>
      </aside>

      <article v-if="selectedOperationPlan" class="panel p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <label class="grid max-w-xl gap-1">
              <span class="label">计划标题</span>
              <input class="field" v-model.trim="editableOperationName" :disabled="saving || !canEditOperation" />
            </label>
            <p class="mt-1 text-sm text-slate-600">{{ operationActivityLabel(selectedOperationPlan) }} · {{ statusLabel(selectedOperationPlan.status) }} · {{ selectedOperationPlan.createdAt }}</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="danger-button" type="button" :disabled="saving || !canDeleteOperation" @click="deleteOperationPlan">
              <Trash2 class="h-4 w-4" />
              删除计划
            </button>
            <button class="primary-button" type="button" :disabled="saving || !canEditOperation" @click="saveOperationPlan">
              <Save class="h-4 w-4" />
              保存修改
            </button>
          </div>
        </div>
        <OperationPlanTable class="mt-4" :plan="selectedOperationPlan" v-model="editableOperationActions" :readonly="!canEditOperation" />
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRaw, watch } from "vue";
import { Download, RefreshCw, Save, Trash2 } from "lucide-vue-next";
import { apiDelete, apiGet, apiPatch, downloadUrl } from "../api";
import OperationPlanTable from "../components/OperationPlanTable.vue";
import PlanActivityView from "../components/PlanActivityView.vue";
import PlanAllocationTable from "../components/PlanAllocationTable.vue";
import PlanStudentView from "../components/PlanStudentView.vue";
import PlanSummary from "../components/PlanSummary.vue";
import type { DemandAllocation, OperationAction, OperationPlan, Plan } from "../types";

const props = defineProps<{
  openOperationPlanId?: string | null;
  initialPlanType?: "credit" | "operation" | null;
}>();

const emit = defineEmits<{
  "opened-operation-plan": [];
}>();

const plans = ref<Plan[]>([]);
const operationPlans = ref<OperationPlan[]>([]);
const selectedPlan = ref<Plan | null>(null);
const selectedOperationPlan = ref<OperationPlan | null>(null);
const editableAllocations = ref<DemandAllocation[]>([]);
const editableOperationActions = ref<OperationAction[]>([]);
const editableOperationName = ref("");
const error = ref("");
const saving = ref(false);
const viewMode = ref("allocations");
const planType = ref<"credit" | "operation">(loadPlanType());
const modes = [
  { key: "allocations", label: "按分配" },
  { key: "students", label: "按人" },
  { key: "activities", label: "按活动" },
  { key: "exceptions", label: "按异常" },
];
const canEditOperation = computed(() => Boolean(selectedOperationPlan.value && ["draft", "ready"].includes(selectedOperationPlan.value.status)));
const canDeleteOperation = computed(() => Boolean(selectedOperationPlan.value && ["draft", "ready", "failed", "cancelled"].includes(selectedOperationPlan.value.status)));

onMounted(load);

watch(() => props.initialPlanType, (type) => {
  if (type) {
    setPlanType(type);
  }
}, { immediate: true });

watch(() => props.openOperationPlanId, async (planId) => {
  if (planId) {
    setPlanType("operation");
    await load();
  }
});

async function load() {
  error.value = "";
  if (props.openOperationPlanId) {
    setPlanType("operation");
  }
  try {
    const [credit, operation] = await Promise.all([
      apiGet<Plan[]>("/api/plans"),
      apiGet<OperationPlan[]>("/api/operation-plans"),
    ]);
    plans.value = credit;
    operationPlans.value = operation;
    if (!selectedPlan.value && plans.value.length > 0) {
      select(plans.value[0]);
    }
    if (props.openOperationPlanId) {
      openOperationPlan(props.openOperationPlanId);
    } else if (!selectedOperationPlan.value && operationPlans.value.length > 0) {
      selectOperation(operationPlans.value[0]);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function select(plan: Plan) {
  selectedPlan.value = plan;
  editableAllocations.value = cloneEditable(plan.allocations);
}

function selectOperation(plan: OperationPlan) {
  selectedOperationPlan.value = plan;
  editableOperationName.value = plan.name;
  editableOperationActions.value = cloneEditable(plan.actions);
}

function openOperationPlan(planId: string) {
  const plan = operationPlans.value.find((item) => item.id === planId);
  if (!plan) {
    return;
  }
  setPlanType("operation");
  selectOperation(plan);
  emit("opened-operation-plan");
}

function setPlanType(type: "credit" | "operation") {
  planType.value = type;
  localStorage.setItem("daomeng:plan-center:type", type);
}

function loadPlanType(): "credit" | "operation" {
  return localStorage.getItem("daomeng:plan-center:type") === "operation" ? "operation" : "credit";
}

function statusLabel(status: Plan["status"] | OperationPlan["status"]): string {
  const labels: Record<Plan["status"], string> = {
    draft: "草稿",
    ready: "已计划",
    running: "执行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[status];
}

function operationActivityLabel(plan: OperationPlan): string {
  const names = plan.activityNames?.length ? plan.activityNames : [plan.activityName];
  return names.length === 1 ? names[0] : `${names.length} 个活动`;
}

function cloneEditable<T>(value: T): T {
  return structuredClone(toCloneable(value));
}

function toCloneable<T>(value: T): T {
  const raw = toRaw(value);
  if (Array.isArray(raw)) {
    return raw.map((item) => toCloneable(item)) as T;
  }
  if (raw && typeof raw === "object") {
    return Object.fromEntries(Object.entries(raw).map(([key, item]) => [key, toCloneable(item)])) as T;
  }
  return raw;
}

async function savePlan() {
  if (!selectedPlan.value) {
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    selectedPlan.value = await apiPatch<Plan>(`/api/plans/${selectedPlan.value.id}`, {
      allocations: cloneEditable(editableAllocations.value),
    });
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function saveOperationPlan() {
  if (!selectedOperationPlan.value) {
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    selectedOperationPlan.value = await apiPatch<OperationPlan>(`/api/operation-plans/${selectedOperationPlan.value.id}`, {
      name: editableOperationName.value,
      actions: cloneEditable(editableOperationActions.value),
    });
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}

async function deleteOperationPlan() {
  if (!selectedOperationPlan.value) {
    return;
  }
  const confirmed = window.confirm(`确认删除操作计划「${selectedOperationPlan.value.name}」？`);
  if (!confirmed) {
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const deletedId = selectedOperationPlan.value.id;
    await apiDelete(`/api/operation-plans/${deletedId}`);
    operationPlans.value = operationPlans.value.filter((plan) => plan.id !== deletedId);
    selectedOperationPlan.value = operationPlans.value[0] ?? null;
    editableOperationName.value = selectedOperationPlan.value?.name ?? "";
    editableOperationActions.value = selectedOperationPlan.value ? cloneEditable(selectedOperationPlan.value.actions) : [];
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}
</script>
