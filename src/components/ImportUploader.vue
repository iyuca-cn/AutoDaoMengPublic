<template>
  <form class="flex flex-wrap items-end gap-3" @submit.prevent="submit">
    <label class="grid gap-1">
      <span class="label">xlsx 文件</span>
      <input ref="inputRef" class="field w-72 max-w-full" type="file" accept=".xlsx,.xls" />
    </label>
    <button class="primary-button" type="submit" :disabled="loading">
      <Upload class="h-4 w-4" />
      上传导入
    </button>
  </form>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Upload } from "lucide-vue-next";
import { apiPost } from "../api";
import type { ImportBatch } from "../types";

defineProps<{
  loading: boolean;
}>();

const emit = defineEmits<{
  uploaded: [batch: ImportBatch];
  error: [message: string];
}>();

const inputRef = ref<HTMLInputElement | null>(null);

async function submit() {
  const file = inputRef.value?.files?.[0];
  if (!file) {
    emit("error", "请选择 xlsx 文件");
    return;
  }
  const form = new FormData();
  form.set("file", file);
  try {
    emit("uploaded", await apiPost<ImportBatch>("/api/imports", form));
    if (inputRef.value) {
      inputRef.value.value = "";
    }
  } catch (error) {
    emit("error", error instanceof Error ? error.message : String(error));
  }
}
</script>
