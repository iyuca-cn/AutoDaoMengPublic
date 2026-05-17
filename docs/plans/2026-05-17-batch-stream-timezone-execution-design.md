# 批量流式执行与统一时区设计

## 目标

把补签和学分发放从逐人执行改为按批次执行，并让前后端对用户时区采用同一套协议。即使任务失败，也要能导出已完成详情和计划中剩余未完成部分。

## 执行粒度

- 补签按活动分组：同一个活动里所有仍需补签的 `signUpId` 一次调用 `resign(activityId, signUpIds, false)`。
- 发放按活动和学分项分组：同一个活动、同一个 `creditId` 下所有要发放的 `userId` 一次调用 `sendCredit(activityId, creditId, userIds)`。
- `resignThenIssueCredit` 先批量补签，再批量发放。某活动补签批次失败时，依赖该补签批次的人员不继续发放。
- 执行事件按批次写入任务事件，并通过现有 NDJSON stream 推给前端。

## 时区协议

- 前端所有 API 请求带 `X-User-Timezone`，值来自 `Intl.DateTimeFormat().resolvedOptions().timeZone`。
- 后端统一解析请求时区，存储继续使用 UTC ISO 字符串用于排序和审计。
- 后端需要返回或导出面向用户阅读的时间时，按请求时区格式化。
- 前端显示时间也统一走显式 `timeZone` 的格式化函数。

## 失败导出

- 执行明细继续记录个人级成功、跳过和失败详情。
- 导出执行结果时新增“剩余未完成明细”工作表。
- 剩余未完成明细从任务结果详情和原计划计算：计划中没有成功或跳过记录的个人学分项、补签动作，标记为未完成；已有失败记录的保留失败原因。

## 主要改动

- `src/api.ts`：统一附加用户时区请求头，下载 URL 带时区参数。
- `src` 时间展示组件：统一使用带用户时区的格式化函数。
- `server/http.ts` 或新增时间工具：解析、校验、格式化请求时区。
- `server/domain/executor.ts`：Excel 学分计划改为批量补签、批量发放、批次级事件。
- `server/domain/operationExecutor.ts`：活动操作计划改为批量补签、批量发放、批次级事件。
- `server/local-api/client.ts`：写操作支持更长请求超时。
- `server/domain/reports.ts`：导出已完成详情和剩余未完成明细。
- 测试覆盖批量调用、时区请求头、写操作超时、失败任务导出剩余部分。

