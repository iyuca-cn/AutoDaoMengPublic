<template>
  <section class="grid gap-4">
    <div class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">导入中心</h2>
          <p class="mt-1 text-sm text-slate-600">上传包含学号、姓名、学分类型、学分数值的 xlsx。</p>
        </div>
      </div>
      <ImportUploader class="mt-4" :loading="loading" @uploaded="setBatch" @error="error = $event" />
      <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
    </div>

    <div v-if="batch" class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="font-semibold">{{ batch.filename }}</h3>
          <p class="mt-1 text-sm text-slate-600">原始 {{ batch.rows.length }} 行，聚合 {{ editableDemands.length }} 条，错误 {{ batch.errors.length }} 条</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="primary-button" type="button" :disabled="generating" @click="generatePlan(false)">
            <WandSparkles class="h-4 w-4" />
            直接生成 plan
          </button>
          <button class="text-button" type="button" :disabled="generating" @click="generatePlan(true)">
            <Save class="h-4 w-4" />
            保存修改后生成
          </button>
        </div>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-[1fr_18rem]">
        <ImportedDemandTable v-model="editableDemands" />
        <aside class="grid content-start gap-3">
          <div class="rounded border border-line bg-paper p-3">
            <h4 class="text-sm font-semibold">校验错误</h4>
            <ul class="mt-2 grid gap-2 text-sm text-clay">
              <li v-for="item in batch.errors" :key="`${item.rowNumber}-${item.field}`">
                第 {{ item.rowNumber }} 行 {{ item.field }}：{{ item.message }}
              </li>
              <li v-if="batch.errors.length === 0" class="text-slate-500">没有校验错误</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Save, WandSparkles } from "lucide-vue-next";
import { apiPost } from "../api";
import ImportUploader from "../components/ImportUploader.vue";
import ImportedDemandTable from "../components/ImportedDemandTable.vue";
import type { ImportBatch, Plan, PriorityDemandRecord } from "../types";

const emit = defineEmits<{
  "plan-created": [plan: Plan];
}>();

const batch = ref<ImportBatch | null>(null);
const editableDemands = ref<PriorityDemandRecord[]>([]);
const loading = ref(false);
const generating = ref(false);
const error = ref("");

function setBatch(value: ImportBatch) {
  batch.value = value;
  editableDemands.value = structuredClone(value.aggregatedDemands);
  error.value = "";
}

async function generatePlan(useEdits: boolean) {
  if (!batch.value) {
    return;
  }
  generating.value = true;
  error.value = "";
  try {
    const plan = await apiPost<Plan>(`/api/imports/${batch.value.id}/generate-plan`, {
      name: `${batch.value.filename} 计划`,
      editedDemands: useEdits ? editableDemands.value : undefined,
    });
    emit("plan-created", plan);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    generating.value = false;
  }
}
</script>
