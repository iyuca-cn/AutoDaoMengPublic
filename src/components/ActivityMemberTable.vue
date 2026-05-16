<template>
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th class="w-10">
            <span class="sr-only">选择</span>
          </th>
          <th>姓名</th>
          <th>学号</th>
          <th>报名 ID</th>
          <th>用户 ID</th>
          <th>签到</th>
          <th>名单</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        <tr v-for="person in rows" :key="rowKey(person)">
          <td>
            <input
              class="h-4 w-4 accent-moss"
              type="checkbox"
              :disabled="!person.signUpId"
              :checked="Boolean(person.signUpId && selectedIds.includes(person.signUpId))"
              @change="person.signUpId && $emit('toggle', person.signUpId)"
            />
          </td>
          <td class="font-medium">{{ person.studentName }}</td>
          <td>{{ person.studentId || "-" }}</td>
          <td>{{ person.signUpId || "-" }}</td>
          <td>{{ person.userId || "-" }}</td>
          <td>{{ signLabel(person.signStatus) }}</td>
          <td>{{ admitLabel(person.admitStatus) }}</td>
        </tr>
        <tr v-if="rows.length === 0">
          <td colspan="7" class="py-8 text-center text-slate-500">暂无人员数据</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { ActivityPersonRow, AdmitStatus, SignStatus } from "../types";

defineProps<{
  rows: ActivityPersonRow[];
  selectedIds: string[];
}>();

defineEmits<{
  toggle: [signUpId: string];
}>();

function rowKey(person: ActivityPersonRow): string {
  return person.signUpId || `${person.studentId ?? ""}-${person.studentName}-${person.source ?? ""}`;
}

function signLabel(status?: SignStatus): string {
  const labels: Record<SignStatus, string> = {
    unsigned: "未签",
    signed: "已签",
    signout: "签退",
    leave: "请假",
    unknown: "未知",
  };
  return labels[status ?? "unknown"];
}

function admitLabel(status?: AdmitStatus): string {
  const labels: Record<AdmitStatus, string> = {
    register: "报名",
    admit: "录取",
    leave: "请假",
    unknown: "未知",
  };
  return labels[status ?? "unknown"];
}
</script>
