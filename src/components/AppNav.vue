<template>
  <nav class="flex flex-wrap gap-2">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="text-button"
      :class="active === item.key ? 'border-moss bg-mint text-moss' : ''"
      @click="$emit('update:active', item.key)"
    >
      <component :is="item.icon" class="h-4 w-4" />
      <span>{{ item.label }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { ClipboardList, FileSpreadsheet, Gauge, PlayCircle, Settings, Shuffle } from "lucide-vue-next";

defineProps<{
  active: string;
}>();

defineEmits<{
  "update:active": [value: string];
}>();

const items = [
  { key: "activities", label: "活动总览", icon: Gauge },
  { key: "imports", label: "导入中心", icon: FileSpreadsheet },
  { key: "plans", label: "计划中心", icon: ClipboardList },
  { key: "execution", label: "执行中心", icon: PlayCircle },
  { key: "random", label: "随机消耗", icon: Shuffle },
  { key: "settings", label: "配置", icon: Settings },
];
</script>
