<template>
  <div class="flex flex-wrap items-end gap-3">
    <label v-for="filter in filters" :key="filter.key" class="grid gap-1">
      <span class="label">{{ filter.label }}</span>
      <input
        v-if="filter.type !== 'select'"
        class="field w-44 max-w-full"
        :value="modelValue[filter.key] ?? ''"
        @input="update(filter.key, ($event.target as HTMLInputElement).value)"
      />
      <select
        v-else
        class="field w-44 max-w-full"
        :value="modelValue[filter.key] ?? ''"
        @change="update(filter.key, ($event.target as HTMLSelectElement).value)"
      >
        <option value="">全部</option>
        <option v-for="option in filter.options" :key="option" :value="option">{{ option }}</option>
      </select>
    </label>
    <button type="button" class="icon-button" title="刷新" @click="$emit('refresh')">
      <RefreshCw class="h-4 w-4" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { RefreshCw } from "lucide-vue-next";

interface FilterConfig {
  key: string;
  label: string;
  type?: "text" | "select";
  options?: string[];
}

const props = defineProps<{
  filters: FilterConfig[];
  modelValue: Record<string, string>;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: Record<string, string>];
  refresh: [];
}>();

function update(key: string, value: string) {
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}
</script>
