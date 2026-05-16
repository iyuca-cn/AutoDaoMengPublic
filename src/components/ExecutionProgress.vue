<template>
  <div class="rounded border border-line bg-white p-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h4 class="font-semibold">执行进度</h4>
      <span class="text-sm text-slate-500">{{ task.status }}</span>
    </div>
    <ol class="mt-3 grid gap-2 text-sm">
      <li v-for="event in task.events" :key="`${event.time}-${event.message}`" class="flex gap-2">
        <span class="w-36 shrink-0 text-xs text-slate-500">{{ event.time }}</span>
        <span>{{ event.message }}</span>
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import type { ExecutionTask } from "../types";

defineProps<{
  task: ExecutionTask;
}>();
</script>
