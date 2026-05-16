# 登录与活动操作计划设计

## 目标

在现有 Bun + Vite + Vue + TailwindCSS + TypeScript Web 应用中补齐登录能力，并把活动页里的补签、发放学分等线上写操作统一纳入“先生成计划，再预检执行”的工作流。

登录支持两种方式：

- 账号密码登录。
- 从“管理活动 -> 人员管理 -> 导出”跳转 URL 中提取登录态。

持久态可选，第一版只允许保存 `uid/token`。账号和密码只用于本次登录请求，不写入本地 JSON、日志或配置文件。

## 关键约束

- 回复和文档面向本仓库，实施技术栈固定为 Bun、Vite、Vue、TailwindCSS、TypeScript。
- 后端继续通过本地 `dmlocalapi_server.exe` HTTP 代理访问到梦空间能力。
- 前端不直接访问本地代理，也不直接保存 `uid/token`。
- 不把“兜底设计”作为正式架构手段。登录失败、接口缺失、计划不可执行时必须明确报错或标记为不支持。
- 所有线上写操作都必须先生成操作计划，经执行中心预检和显式确认后执行。
- 计划文档和设计文档写入后不自动提交 git。

## 参考现状

当前 Web 后端已有 `DmLocalApiClient`，已封装这些登录和活动代理接口：

- `POST /session/login`
- `POST /session`
- `POST /session/import-export-url`
- `GET /manage/activities`
- `GET /sign/card/:activityId`
- `GET /sign/list`
- `POST /sign/resign`
- `GET /credit/types`
- `POST /credit/list`
- `POST /credit/send`
- `POST /credit/send-by-signup-id`
- `POST /credit/find-not-sent`
- `GET /export/members`

当前 Web 已有活动总览、导入中心、计划中心、执行中心和配置页，但活动页写操作按钮还只是界面占位。现有 `Plan` 面向 Excel 导入后的学分分配，执行器可补签并发放计划中的学分项。

`AutoDaoMengPublic` 的登录流程提供两个重要约定：

- 存在 `uid/token` 时先调用 `/session` 恢复，再用 `/activities` 验证登录态。
- 导出 URL 必须形如 `https://apph5.5idream.net/apih5/api/activity/join/export?activityid=...`，且必须包含 `api_token`。

## 推荐方案

采用统一操作计划方案。

Excel 导入生成的学分计划继续保留为 `creditPlan`。活动详情页里的人工操作生成新的 `operationPlan`。两种计划都走执行中心的预检、确认、任务执行和审计记录，但各自保留清晰的数据结构。

这样能避免把补签、发放学分这类写操作散落在前端按钮中，也方便后续扩展“批量补签”“按学分项补发”“先补签再发放”等能力。

## 后端设计

### 会话存储

新增 `server/domain/session.ts` 和 `server/routes/sessionRoutes.ts`。

会话文件建议写入 `data/session/session.json`，只保存：

- `uid`
- `token`
- `savedAt`
- `lastVerifiedAt`
- `source`: `account` 或 `exportUrl`

不保存：

- `account`
- `pwd`
- 原始导出 URL
- `api_token`

后端启动不自动强行登录，但提供 `GET /api/session` 让前端查询状态。该接口会：

1. 检查本地是否存在 `uid/token`。
2. 如果存在，调用本地代理 `/session` 恢复。
3. 再调用 `/activities` 或 `/manage/activities` 验证登录态是否有效。
4. 返回 `authenticated`、`source`、`savedAt`、`lastVerifiedAt`，不返回 token 明文。

登录接口：

- `POST /api/session/login`：接收 `{ account, pwd, persist }`，调用 `/session/login`。
- `POST /api/session/import-export-url`：接收 `{ url, persist }`，先校验 URL 前缀和 `api_token`，再调用 `/session/import-export-url`。
- `POST /api/session/restore`：使用本地保存的 `uid/token` 恢复登录态。
- `DELETE /api/session`：删除本地 session 文件，并清空前端状态。

当 `persist=false` 时，后端只把 `uid/token` 保存在内存 session 中。第一版单用户本地操作台可以接受进程级内存态；进程重启后需要重新登录。

### 活动详情

新增活动详情聚合函数 `getActivityDetail(activityId)`，输出一个前端可直接渲染的详情模型：

- 活动基础信息。
- 签到卡状态。
- 签到名单：未签到、已签到、签退、请假。
- 成员名单：报名、录取、请假。
- 学分项列表：`creditId`、`scoreId`、学分类型、分值、总容量、已发数、剩余容量。
- 每个学分项的候选名单、其他成员名单、已发名单和未发名单。

后端新增路由：

- `GET /api/activities/:activityId`
- `POST /api/activities/refresh`
- `POST /api/activities/:activityId/refresh`

刷新只是重新拉取代理数据，不写线上业务数据。活动详情不使用空数据伪装成功；代理失败时返回明确错误。

### 操作计划模型

在 `server/domain/models.ts` 新增独立模型：

```ts
export type OperationPlanStatus = "draft" | "ready" | "running" | "completed" | "failed" | "cancelled";
export type OperationKind = "resign" | "issueCredit" | "resignThenIssueCredit";

export interface OperationPlan {
  id: string;
  name: string;
  kind: OperationKind;
  activityId: string;
  activityName: string;
  createdAt: string;
  status: OperationPlanStatus;
  actions: OperationAction[];
  precheck?: OperationPrecheckReport;
  summary: OperationPlanSummary;
  auditLogs: AuditLogEntry[];
}

export interface OperationAction {
  id: string;
  kind: OperationKind;
  studentId?: string;
  studentName: string;
  signUpId: string;
  userId?: string;
  creditItems: OperationCreditItem[];
  enabled: boolean;
  status: AssignmentStatus;
  note?: string;
}
```

操作计划存储在 `data/operation-plans/*.json`。不要强行塞进现有 Excel `Plan`，避免两类计划语义混淆。

生成操作计划的路由：

- `POST /api/operation-plans`
- `GET /api/operation-plans`
- `GET /api/operation-plans/:id`
- `PATCH /api/operation-plans/:id`

创建参数支持：

- 从活动详情选中人员生成补签计划。
- 从活动详情选中人员和学分项生成发放计划。
- 对未签到人员生成“补签后发放”计划。

计划生成阶段只保存计划，不调用 `/sign/resign` 或 `/credit/send`。

### 操作预检与执行

新增 `server/domain/operationExecutor.ts`，复用现有任务机制或扩展 `TaskRunner` 支持 `task.targetType`：

- `creditPlan`
- `operationPlan`

预检路由：

- `POST /api/operation-plans/:id/precheck`

执行路由：

- `POST /api/operation-plans/:id/execute`

预检内容：

- 当前 session 是否有效。
- 活动是否仍存在。
- 活动是否有签到卡。
- 目标报名记录是否仍在录取名单或相关签到名单中。
- 需要补签的人是否仍未签到。
- 需要发放的人是否已有对应学分项。
- 学分项是否仍有剩余容量。
- `userId` 是否可用；如果计划中没有 `userId`，从签到/录取数据重新映射。

执行顺序：

1. 对 `resign` 或 `resignThenIssueCredit` 中仍未签到的人员定向补签。
2. 对每个学分项重新读取已发名单。
3. 跳过已发人员。
4. 调用发放接口。
5. 调用未发查询或重新读取已发名单校验结果。
6. 写入任务事件、计划状态和审计日志。

执行必须要求前端传入明确确认文本。后端也校验确认文本，避免只靠前端禁用按钮。

## 前端设计

### 登录体验

新增 `LoginView.vue` 或 `SessionPanel.vue`。未登录时，主区域显示登录工作台，不展示活动操作按钮。

登录界面包括两个 tab：

- 账号密码：账号、密码、是否保存登录态。
- URL 提取：导出 URL、是否保存登录态。

登录后顶部显示：

- 已登录状态。
- 登录态来源。
- 最近验证时间。
- 重新验证按钮。
- 退出登录按钮。

不要在 UI 中展示 token。

### 活动详情页

活动总览保持紧凑列表，点击活动进入详情抽屉或详情区域。详情页提供：

- 活动概况。
- 签到状态 tab。
- 学分项 tab。
- 人员明细表。
- 学分发放明细表。
- 当前筛选和选择条。

人员筛选支持：

- 姓名。
- 学号。
- `signUpId`。
- `userId`。
- 签到状态。
- 是否录取。
- 学分发放状态。
- 学分类型。

操作按钮：

- 生成补签计划。
- 生成发放计划。
- 生成补签后发放计划。
- 加入现有操作计划。

按钮只生成计划，不直接写线上。

### 操作计划中心

计划中心增加 `Excel 学分计划` 和 `活动操作计划` 两类视图，或新增独立 `操作计划` 页面。第一版建议放在计划中心 tab 内，减少导航膨胀。

操作计划可查看：

- 活动。
- 操作类型。
- 人员数。
- 学分项数。
- 预计补签数。
- 预计发放数。
- 异常和跳过项。

草稿状态允许禁用 action。运行后不允许直接修改，需要复制为新计划。

### 执行中心

执行中心计划选择器同时列出两类可执行计划，并清晰标注类型。

确认文本建议：

- Excel 学分计划：`执行计划`
- 活动操作计划：`执行操作计划`

执行结果中展示：

- 补签成功。
- 发放成功。
- 已发跳过。
- 预检失败。
- 执行失败。
- 校验失败。

## 安全与日志

敏感字段脱敏范围增加：

- `uid`
- `token`
- `api_token`
- `pwd`
- `account`
- 原始导出 URL

后端普通日志、任务事件、审计日志都不能写入账号、密码、token 或完整 URL。导出 URL 最多记录 host、path 和 query key，不记录 query value。

## 错误处理

必须显式区分：

- 未登录。
- 登录态失效。
- 本地代理未启动。
- 本地代理接口失败。
- URL 格式不合法。
- 活动不存在。
- 签到卡不存在。
- 人员不在录取名单。
- 学分已发。
- 学分项容量不足。
- 发放后校验失败。

这些错误不转换为空计划、不自动切换到另一种写操作。

## 测试策略

后端测试：

- session 存储只保存 `uid/token`。
- 账号密码登录不会落盘账号密码。
- URL 导入校验前缀和 `api_token`。
- session 恢复失败时返回未登录状态。
- 活动详情聚合名单和学分项。
- 操作计划创建不调用写接口。
- 操作预检覆盖签到卡、录取、已发、容量。
- 操作执行覆盖补签、发放、跳过和失败记录。

前端测试：

- 未登录显示登录界面。
- 登录成功后进入活动总览。
- 活动详情筛选和选择稳定。
- 生成操作计划后能在计划中心看到。
- 执行中心预检和确认文本工作正常。

端到端测试：

- mock 本地代理完成账号登录。
- mock 导出 URL 登录。
- 从活动详情生成补签计划。
- 从活动详情生成发放计划。
- 执行操作计划并展示结果。

## 分阶段交付

第一阶段：

- session 后端、登录 UI、会话状态栏。
- 活动详情只读聚合。
- 活动总览登录态校验。

第二阶段：

- 操作计划模型、存储、创建和计划中心展示。
- 活动详情生成补签/发放/补签后发放计划。

第三阶段：

- 操作计划预检和执行。
- 执行中心支持两类计划。
- 测试、视觉验证和构建验证。
