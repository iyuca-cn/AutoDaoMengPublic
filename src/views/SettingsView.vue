<template>
  <section class="grid gap-4">
    <div class="panel p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">配置</h2>
          <p class="mt-1 text-sm text-slate-600">查看 DM 本地代理路径、端口、自动启动和服务状态。</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="text-button" type="button" @click="load">
            <RefreshCw class="h-4 w-4" />
            刷新
          </button>
          <button class="primary-button" type="button" @click="startProxy">
            <Power class="h-4 w-4" />
            启动代理
          </button>
        </div>
      </div>
      <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
    </div>

    <div class="panel p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="font-semibold">登录态</h3>
          <p class="mt-1 text-sm text-slate-600">
            {{ session?.authenticated ? `${sourceLabel(session.source)} · 最近验证 ${formatTime(session.lastVerifiedAt)}` : "当前未登录" }}
          </p>
        </div>
        <button class="text-button" type="button" @click="loadSession">
          <RefreshCw class="h-4 w-4" />
          重新验证
        </button>
      </div>
    </div>

    <div v-if="config" class="panel p-4">
      <dl class="grid gap-3 sm:grid-cols-2">
        <div class="rounded border border-line bg-paper p-3">
          <dt class="label">后端端口</dt>
          <dd class="mt-1 font-medium">{{ config.port }}</dd>
        </div>
        <div class="rounded border border-line bg-paper p-3">
          <dt class="label">数据目录</dt>
          <dd class="mt-1 break-all font-medium">{{ config.dataDir }}</dd>
        </div>
        <div class="rounded border border-line bg-paper p-3">
          <dt class="label">代理地址</dt>
          <dd class="mt-1 break-all font-medium">{{ config.localApi.baseUrl }}</dd>
        </div>
        <div class="rounded border border-line bg-paper p-3">
          <dt class="label">自动启动</dt>
          <dd class="mt-1 font-medium">{{ config.localApi.autoStart ? "开启" : "关闭" }}</dd>
        </div>
        <div class="rounded border border-line bg-paper p-3 sm:col-span-2">
          <dt class="label">可执行文件</dt>
          <dd class="mt-1 break-all font-medium">{{ config.localApi.executablePath }}</dd>
          <p class="mt-2 text-sm" :class="config.localApi.executableExists ? 'text-moss' : 'text-clay'">
            {{ config.localApi.executableExists ? "路径存在" : "路径不存在" }}
          </p>
        </div>
      </dl>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Power, RefreshCw } from "lucide-vue-next";
import { apiGet, apiPost } from "../api";
import type { SessionSource, SessionStatus } from "../types";

interface ConfigResponse {
  port: number;
  dataDir: string;
  localApi: {
    baseUrl: string;
    executablePath: string;
    autoStart: boolean;
    port: number;
    startupTimeoutMs: number;
    executableExists: boolean;
  };
}

const config = ref<ConfigResponse | null>(null);
const session = ref<SessionStatus | null>(null);
const error = ref("");

onMounted(async () => {
  await Promise.all([load(), loadSession()]);
});

async function load() {
  error.value = "";
  try {
    config.value = await apiGet<ConfigResponse>("/api/config");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function loadSession() {
  error.value = "";
  try {
    session.value = await apiGet<SessionStatus>("/api/session");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function startProxy() {
  error.value = "";
  try {
    await apiPost("/api/local-api/start");
    await load();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
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
