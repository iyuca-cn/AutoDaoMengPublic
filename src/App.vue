<template>
  <div class="min-h-screen bg-paper">
    <header class="border-b border-line bg-white">
      <div class="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold text-ink">到梦空间操作台</h1>
            <p class="mt-1 text-sm text-slate-600">活动查询、Excel 导入、计划生成、执行与报表</p>
          </div>
          <div class="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <div class="flex items-center gap-2">
              <span class="h-2 w-2 rounded-full" :class="healthOk ? 'bg-moss' : 'bg-clay'" />
              {{ healthOk ? "后端正常" : "后端待检查" }}
            </div>
            <div v-if="session.authenticated" class="flex flex-wrap items-center gap-2">
              <span class="rounded border border-line bg-paper px-2 py-1 text-xs">
                {{ sourceLabel(session.source) }} · {{ formatTime(session.lastVerifiedAt) }}
              </span>
              <button class="text-button min-h-8 px-2 py-1 text-xs" type="button" @click="logout">
                <LogOut class="h-3.5 w-3.5" />
                退出
              </button>
            </div>
          </div>
        </div>
        <AppNav v-if="session.authenticated" v-model:active="activeView" />
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <LoginView v-if="!session.authenticated" @authenticated="onAuthenticated" />
      <ActivityOverview v-else-if="activeView === 'activities'" @open-plans="activeView = 'plans'" />
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
import { LogOut } from "lucide-vue-next";
import { apiDelete, apiGet } from "./api";
import AppNav from "./components/AppNav.vue";
import ActivityOverview from "./views/ActivityOverview.vue";
import ExecutionCenter from "./views/ExecutionCenter.vue";
import ImportCenter from "./views/ImportCenter.vue";
import LoginView from "./views/LoginView.vue";
import PlanCenter from "./views/PlanCenter.vue";
import RandomDrainView from "./views/RandomDrainView.vue";
import SettingsView from "./views/SettingsView.vue";
import type { SessionSource, SessionStatus } from "./types";

const activeView = ref("activities");
const healthOk = ref(false);
const session = ref<SessionStatus>({ authenticated: false });

onMounted(async () => {
  try {
    await apiGet("/api/health");
    healthOk.value = true;
  } catch {
    healthOk.value = false;
  }
  await loadSession();
});

async function loadSession() {
  try {
    session.value = await apiGet<SessionStatus>("/api/session");
  } catch {
    session.value = { authenticated: false };
  }
}

function onAuthenticated(status: SessionStatus) {
  session.value = status;
  activeView.value = "activities";
}

async function logout() {
  session.value = await apiDelete<SessionStatus>("/api/session");
  activeView.value = "activities";
}

function sourceLabel(source?: SessionSource): string {
  return source === "exportUrl" ? "URL 登录" : "账号登录";
}

function formatTime(value?: string): string {
  if (!value) {
    return "未验证";
  }
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
</script>
