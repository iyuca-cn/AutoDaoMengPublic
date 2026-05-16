<template>
  <div class="grid gap-2">
    <h3 v-if="title" class="font-semibold">{{ title }}</h3>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>学分项</th>
            <th>分值</th>
            <th>容量</th>
            <th>候选</th>
            <th>其他</th>
            <th>已发</th>
            <th>未发</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="item in creditItems" :key="creditItemKey(item)">
            <td>
              <label class="inline-flex items-center gap-2">
                <input
                  class="h-4 w-4 accent-moss"
                  type="checkbox"
                  :checked="selectedCreditItemKeys.includes(creditItemKey(item))"
                  @change="$emit('toggle-credit', creditItemKey(item))"
                />
                <span class="font-medium">{{ item.creditType }}</span>
              </label>
              <div class="text-xs text-slate-500">{{ item.scoreId || item.creditId }}</div>
            </td>
            <td>{{ formatCent(item.unitcountCent) }}</td>
            <td>{{ item.issuedCount }} / {{ item.totalCapacity }}，剩余 {{ item.remainingCapacity }}</td>
            <td>{{ lists(item).candidates.length }}</td>
            <td>{{ lists(item).other.length }}</td>
            <td>{{ lists(item).credited.length }}</td>
            <td>{{ lists(item).notSent.length }}</td>
          </tr>
          <tr v-if="creditItems.length === 0">
            <td colspan="7" class="py-8 text-center text-slate-500">{{ emptyText ?? "暂无可用学分项" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ActivityCreditItem, ActivityCreditLists } from "../types";
import { formatCent } from "../types";

const props = defineProps<{
  creditItems: ActivityCreditItem[];
  creditListsByScoreId: Record<string, ActivityCreditLists>;
  selectedCreditItemKeys: string[];
  title?: string;
  emptyText?: string;
}>();

defineEmits<{
  "toggle-credit": [scoreId: string];
}>();

function lists(item: ActivityCreditItem): ActivityCreditLists {
  return props.creditListsByScoreId[item.creditId] ?? props.creditListsByScoreId[item.scoreId] ?? {
    candidates: [],
    other: [],
    credited: [],
    notSent: [],
  };
}

function creditItemKey(item: ActivityCreditItem): string {
  return [item.scoreId, item.creditId, item.creditType, item.unitcountCent].join(":");
}
</script>
