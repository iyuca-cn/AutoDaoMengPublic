<template>
  <section class="grid gap-4">
    <div class="panel p-4">
      <h2 class="text-lg font-semibold">随机消耗</h2>
      <p class="mt-1 text-sm text-slate-600">第一版保留配置与预览入口，确认接口语义补齐后启用执行。</p>
      <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="preview">
        <label class="grid gap-1">
          <span class="label">阈值</span>
          <input class="field w-28" v-model.number="threshold" type="number" min="1" />
        </label>
        <label class="grid gap-1">
          <span class="label">偏移</span>
          <input class="field w-28" v-model.number="jitter" type="number" min="0" />
        </label>
        <label class="grid gap-1">
          <span class="label">种子</span>
          <input class="field w-44" v-model="seed" />
        </label>
        <button class="primary-button" type="submit">
          <Shuffle class="h-4 w-4" />
          生成预览
        </button>
      </form>
      <p v-if="error" class="mt-3 rounded border border-clay/30 bg-red-50 px-3 py-2 text-sm text-clay">{{ error }}</p>
    </div>
    <div v-if="result" class="panel p-4">
      <h3 class="font-semibold">预览结果</h3>
      <p class="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ result.reason }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Shuffle } from "lucide-vue-next";
import { apiPost } from "../api";

const threshold = ref(20);
const jitter = ref(3);
const seed = ref("");
const result = ref<{ supported: false; reason: string } | null>(null);
const error = ref("");

async function preview() {
  error.value = "";
  try {
    result.value = await apiPost("/api/random-drain/preview", {
      threshold: threshold.value,
      jitter: jitter.value,
      seed: seed.value || undefined,
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>
