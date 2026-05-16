<template>
  <div class="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper px-4 py-3">
    <span class="text-sm text-slate-600">已选择 {{ selectedCount }} 项</span>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="text-button" @click="$emit('select-all')">
        <CheckSquare class="h-4 w-4" />
        全选当前筛选
      </button>
      <button type="button" class="text-button" @click="$emit('invert')">
        <Repeat2 class="h-4 w-4" />
        反选当前筛选
      </button>
      <button type="button" class="text-button" @click="$emit('clear')">
        <Square class="h-4 w-4" />
        全不选
      </button>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { CheckSquare, Repeat2, Square } from "lucide-vue-next";

defineProps<{
  selectedCount: number;
}>();

defineEmits<{
  "select-all": [];
  invert: [];
  clear: [];
}>();
</script>
