<template>
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th class="w-10">
            <span class="sr-only">选择</span>
          </th>
          <th>活动</th>
          <th>签到卡</th>
          <th>签到状态</th>
          <th>学分项</th>
          <th>已发</th>
          <th>容量</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        <tr v-for="item in items" :key="item.activityId" class="cursor-pointer hover:bg-mint/40" @click="$emit('open', item.activityId)">
          <td>
            <input
              class="h-4 w-4 accent-moss"
              type="checkbox"
              :checked="selectedIds.includes(item.activityId)"
              @click.stop
              @change="$emit('toggle', item.activityId)"
            />
          </td>
          <td>
            <div class="font-medium">{{ item.activityName }}</div>
            <div class="text-xs text-slate-500">{{ item.activityId }}</div>
          </td>
          <td>
            <span class="inline-flex rounded px-2 py-1 text-xs font-medium" :class="item.hasSignCard ? 'bg-mint text-moss' : 'bg-red-50 text-clay'">
              {{ item.hasSignCard ? "有" : "无" }}
            </span>
          </td>
          <td>
            <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
              <span>未签 {{ item.signCounts.unsigned }}</span>
              <span>已签 {{ item.signCounts.signed }}</span>
              <span>签退 {{ item.signCounts.signout }}</span>
              <span>请假 {{ item.signCounts.leave }}</span>
            </div>
          </td>
          <td>
            <div class="flex flex-wrap gap-1">
              <span v-for="credit in item.creditItems" :key="credit.creditId" class="rounded border border-line bg-paper px-2 py-1 text-xs">
                {{ credit.creditType }} {{ formatCent(credit.unitcountCent) }}
              </span>
            </div>
          </td>
          <td>
            <span>{{ creditedTotal(item) }}</span>
          </td>
          <td>
            <span>{{ capacityTotal(item) }}</span>
          </td>
        </tr>
        <tr v-if="items.length === 0">
          <td colspan="7" class="py-8 text-center text-slate-500">暂无活动数据</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { ActivityOverviewItem } from "../types";
import { formatCent } from "../types";

defineProps<{
  items: ActivityOverviewItem[];
  selectedIds: string[];
}>();

defineEmits<{
  toggle: [activityId: string];
  open: [activityId: string];
}>();

function creditedTotal(item: ActivityOverviewItem): number {
  return Object.values(item.creditedCounts).reduce((sum, value) => sum + value, 0);
}

function capacityTotal(item: ActivityOverviewItem): number {
  return item.creditItems.reduce((sum, credit) => sum + credit.remainingCapacity, 0);
}
</script>
