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
      <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
    </div>

    <div class="grid gap-4 lg:grid-cols-[18rem_1fr]">
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
            <div class="mt-1 text-xs text-slate-500">{{ plan.status }} · {{ plan.summary.plannedIssueCount }} 项</div>
          </button>
          <p v-if="plans.length === 0" class="text-sm text-slate-500">暂无计划</p>
        </div>
      </aside>

      <article v-if="selectedPlan" class="panel p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="text-base font-semibold">{{ selectedPlan.name }}</h3>
            <p class="mt-1 text-sm text-slate-600">{{ selectedPlan.status }} · {{ selectedPlan.generatedAt }}</p>
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
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Download, RefreshCw, Save } from "lucide-vue-next";
import { apiGet, apiPatch, downloadUrl } from "../api";
import PlanActivityView from "../components/PlanActivityView.vue";
import PlanAllocationTable from "../components/PlanAllocationTable.vue";
import PlanStudentView from "../components/PlanStudentView.vue";
import PlanSummary from "../components/PlanSummary.vue";
import type { DemandAllocation, Plan } from "../types";

const plans = ref<Plan[]>([]);
const selectedPlan = ref<Plan | null>(null);
const editableAllocations = ref<DemandAllocation[]>([]);
const error = ref("");
const saving = ref(false);
const viewMode = ref("allocations");
const modes = [
  { key: "allocations", label: "按分配" },
  { key: "students", label: "按人" },
  { key: "activities", label: "按活动" },
  { key: "exceptions", label: "按异常" },
];

onMounted(load);

async function load() {
  error.value = "";
  try {
    plans.value = await apiGet<Plan[]>("/api/plans");
    if (!selectedPlan.value && plans.value.length > 0) {
      select(plans.value[0]);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function select(plan: Plan) {
  selectedPlan.value = plan;
  editableAllocations.value = structuredClone(plan.allocations);
}

async function savePlan() {
  if (!selectedPlan.value) {
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    selectedPlan.value = await apiPatch<Plan>(`/api/plans/${selectedPlan.value.id}`, {
      allocations: editableAllocations.value,
    });
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}
</script>
