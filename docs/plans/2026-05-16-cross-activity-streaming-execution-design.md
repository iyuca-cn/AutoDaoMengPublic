# 跨活动操作计划与流式执行设计

## 目标

补齐三个能力：

- 执行中心可以重新执行失败的 Excel 学分计划和活动操作计划。
- 活动总览在多选活动后可以查看跨活动详情，并生成一个跨活动操作计划。
- 前后端对慢操作使用流式通信，尤其是活动详情读取、跨活动详情读取、预检和执行。

## 约束

- 不把兜底设计当作正式架构手段。接口失败、活动读取失败、计划不可执行时必须明确暴露错误。
- 所有线上写操作仍必须先生成计划，再预检，再确认执行。
- 流式接口用于需要进度反馈的慢操作；普通列表和短查询继续保留 JSON。
- 计划文档和设计文档写入后不自动提交 git。

## 推荐架构

保留现有 `OperationPlan` 概念，但扩展为支持跨活动：

- 顶层保留 `activityId`、`activityName` 兼容旧计划。
- 新增 `activityIds`、`activityNames` 表达计划覆盖范围。
- 每条 `OperationAction` 新增 `activityId`、`activityName`，执行和预检以 action 自身活动为准。

这样旧计划无需迁移即可读取，新计划可以跨活动执行。执行器不再默认使用顶层活动 ID，以避免跨活动时读错签到卡、名单或学分项。

## 流式协议

新增轻量 NDJSON 协议，每行一个事件：

```json
{"type":"started","message":"开始读取活动详情"}
{"type":"progress","message":"已读取活动 A","data":{}}
{"type":"data","data":{}}
{"type":"completed","data":{}}
{"type":"error","message":"活动读取失败","data":{}}
```

后端统一返回 `application/x-ndjson; charset=utf-8`。前端 `apiStream` 逐行解析并回调事件。流式错误不会伪装成空结果；如果后端抛错，最后发出 `error` 事件并结束。

优先改为流式的接口：

- `GET /api/activities/:id/stream`
- `POST /api/activities/details/stream`
- `POST /api/plans/:id/precheck/stream`
- `POST /api/plans/:id/execute/stream`
- `POST /api/operation-plans/:id/precheck/stream`
- `POST /api/operation-plans/:id/execute/stream`

原 JSON 接口保留，便于测试和非流式调用。

## 活动总览交互

单活动：

- 点击详情仍打开单活动详情。
- 单活动详情加载改用流式，显示当前读取状态。

多活动：

- 多选后点击“查看详情”进入跨活动详情视图。
- 视图按活动分组展示活动摘要、读取状态、成员和学分项。
- 支持为每个活动选择人员和学分项。
- 点击生成补签、发放、补签后发放时，把每个活动的选择项合并为一个 `OperationPlan`。

跨活动计划只使用每个活动中被选中的人员和学分项，不自动把失败读取的活动纳入计划。

## 执行中心

执行中心计划列表包含：

- `draft`
- `ready`
- `failed`

失败计划重新执行前必须重新预检。执行时创建新的任务，旧任务保留在任务列表和审计日志中。

执行按钮根据状态显示：

- 草稿/已计划：确认执行
- 失败：重新执行

## 错误处理

必须显式区分：

- 活动详情读取失败。
- 批量详情中部分活动读取失败。
- 未登录或登录态失效。
- 本地代理未启动。
- 计划状态不允许修改。
- 计划预检不通过。
- 执行中单个 action 失败。

批量详情允许部分活动读取失败，但这些失败会显示为错误项，不进入计划生成。

## 测试策略

后端测试：

- 跨活动操作计划会为每条 action 写入活动 ID。
- 预检和执行按 action 活动分组调用本地代理。
- `failed` 状态计划可以重新预检和重新执行。
- NDJSON 流式响应能发出 progress、completed 和 error。

前端测试：

- 多选活动可进入跨活动详情。
- 跨活动详情可以选择人员和学分项并生成一个操作计划。
- 执行中心能显示失败计划并要求重新预检。
- 流式执行过程中能实时显示事件。
