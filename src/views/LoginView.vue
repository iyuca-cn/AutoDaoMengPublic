<template>
  <section class="grid gap-4">
    <div class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">登录到梦空间</h2>
          <p class="mt-1 text-sm text-slate-600">登录态由后端维护，前端不会保存 token。</p>
        </div>
        <button class="text-button" type="button" :disabled="loading" @click="restore">
          <RefreshCw class="h-4 w-4" />
          恢复登录态
        </button>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="item in modes"
          :key="item.key"
          class="text-button"
          :class="mode === item.key ? 'border-moss bg-mint text-moss' : ''"
          type="button"
          @click="mode = item.key"
        >
          <component :is="item.icon" class="h-4 w-4" />
          {{ item.label }}
        </button>
      </div>
      <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
    </div>

    <form v-if="mode === 'account'" class="panel grid gap-4 p-4" @submit.prevent="login">
      <label class="grid gap-1">
        <span class="label">账号</span>
        <input class="field" v-model.trim="account" autocomplete="username" />
      </label>
      <label class="grid gap-1">
        <span class="label">密码</span>
        <input class="field" v-model="pwd" type="password" autocomplete="current-password" />
      </label>
      <label class="inline-flex items-center gap-2 text-sm">
        <input class="h-4 w-4 accent-moss" v-model="persist" type="checkbox" />
        保存 uid/token 到本地
      </label>
      <button class="primary-button justify-center" type="submit" :disabled="loading">
        <LogIn class="h-4 w-4" />
        登录
      </button>
    </form>

    <form v-else class="panel grid gap-4 p-4" @submit.prevent="importUrl">
      <label class="grid gap-1">
        <span class="label">导出 URL</span>
        <textarea class="field min-h-32" v-model.trim="exportUrl" />
      </label>
      <label class="inline-flex items-center gap-2 text-sm">
        <input class="h-4 w-4 accent-moss" v-model="persist" type="checkbox" />
        保存 uid/token 到本地
      </label>
      <button class="primary-button justify-center" type="submit" :disabled="loading">
        <Link class="h-4 w-4" />
        提取登录态
      </button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { Link, LogIn, RefreshCw, UserRound } from "lucide-vue-next";
import { ref } from "vue";
import { apiPost } from "../api";
import type { SessionStatus } from "../types";

const emit = defineEmits<{
  authenticated: [status: SessionStatus];
}>();

const modes = [
  { key: "account", label: "账号密码", icon: UserRound },
  { key: "url", label: "URL 提取", icon: Link },
] as const;

const mode = ref<(typeof modes)[number]["key"]>("account");
const account = ref("");
const pwd = ref("");
const exportUrl = ref("");
const persist = ref(false);
const loading = ref(false);
const error = ref("");

async function login() {
  await submit(() => apiPost<SessionStatus>("/api/session/login", {
    account: account.value,
    pwd: pwd.value,
    persist: persist.value,
  }));
}

async function importUrl() {
  await submit(() => apiPost<SessionStatus>("/api/session/import-export-url", {
    url: exportUrl.value,
    persist: persist.value,
  }));
}

async function restore() {
  await submit(() => apiPost<SessionStatus>("/api/session/restore"));
}

async function submit(action: () => Promise<SessionStatus>) {
  loading.value = true;
  error.value = "";
  try {
    const status = await action();
    if (status.authenticated) {
      emit("authenticated", status);
    } else {
      error.value = "登录态未生效，请重新登录";
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
</script>
