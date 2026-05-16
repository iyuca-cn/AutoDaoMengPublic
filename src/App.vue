<template>
  <div class="min-h-screen bg-paper">
    <header class="border-b border-line bg-white">
      <div class="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold text-ink">到梦空间操作台</h1>
            <p class="mt-1 text-sm text-slate-600">活动查询、Excel 导入、计划生成、执行与报表</p>
          </div>
          <div class="flex items-center gap-2 text-sm text-slate-600">
            <span class="h-2 w-2 rounded-full" :class="healthOk ? 'bg-moss' : 'bg-clay'" />
            {{ healthOk ? "后端正常" : "后端待检查" }}
          </div>
        </div>
        <AppNav v-model:active="activeView" />
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <ActivityOverview v-if="activeView === 'activities'" />
      <ImportCenter v-else-if="activeView === 'imports'" @plan-created="activeView = 'plans'" />
      <PlanCenter v-else-if="activeView === 'plans'" />
      <ExecutionCenter v-else-if="activeView === 'execution'" />
      <RandomDrainView v-else-if="activeView === 'random'" />
      <SettingsView v-else />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { apiGet } from "./api";
import AppNav from "./components/AppNav.vue";
import ActivityOverview from "./views/ActivityOverview.vue";
import ExecutionCenter from "./views/ExecutionCenter.vue";
import ImportCenter from "./views/ImportCenter.vue";
import PlanCenter from "./views/PlanCenter.vue";
import RandomDrainView from "./views/RandomDrainView.vue";
import SettingsView from "./views/SettingsView.vue";

const activeView = ref("activities");
const healthOk = ref(false);

onMounted(async () => {
  try {
    await apiGet("/api/health");
    healthOk.value = true;
  } catch {
    healthOk.value = false;
  }
});
</script>
