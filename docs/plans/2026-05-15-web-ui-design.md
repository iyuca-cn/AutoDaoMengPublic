# 到梦空间 Web UI 设计

## 目标

在 `E:\work\daomeng\web` 中实现一个纯 `Bun + Vite + Vue + TailwindCSS + TypeScript` 的前后端一体 Web 应用，用来承接 `AutoDaoMengPublic` 当前的活动查询、Excel 导入、计划生成、计划编辑、执行、报表和随机消耗能力。

项目内不写 Python 代码，不调用 Python CLI 或 Python 模块。现有 `E:\work\daomeng\AutoDaoMengPublic\src\dist\dmlocalapi_server.exe` 只作为外部 HTTP 代理服务。Web 后端通过可配置的代理启动器连接它，并为以后替换成 Linux 可执行程序保留同一套配置和进程管理模型。

## 关键约束

- 技术栈固定为 Bun、Vite、Vue、TailwindCSS、TypeScript。
- 不能把“临时兜底”作为正式架构手段。未实现能力必须显式标注为不支持或待接口补充。
- 导入 xlsx 后无论用户是否修改导入内容，都必须能生成 plan。
- plan 是执行功能的唯一输入。用户可以从导入结果直接生成 plan，也可以先细化修改再生成 plan。
- 已发线上学分的“撤销发放”当前未在 `DMAPI.py` 中找到对应代理接口；Web 第一版的“取消发放”定义为取消计划中的待发放项或取消未执行任务。若需要撤销线上已发学分，必须补充明确代理接口后再实现。

## 总体架构

应用分为三个边界：

1. Vue 前端操作台
2. Bun TypeScript 后端
3. 外部 DM 本地代理进程

前端只调用 Bun 后端的 `/api/*`。Bun 后端负责配置读取、代理进程启动、HTTP 转发封装、xlsx 解析、业务规划、计划持久化、执行任务和导出报表。前端不直接访问 `dmlocalapi_server.exe`，也不保存登录 token。

外部代理配置使用平台无关字段：

- `localApi.baseUrl`
- `localApi.executablePath`
- `localApi.autoStart`
- `localApi.port`
- `localApi.startupTimeoutMs`
- `localApi.workingDirectory`

Windows 默认 `executablePath` 指向 `E:\work\daomeng\AutoDaoMengPublic\src\dist\dmlocalapi_server.exe`。Linux 部署时只替换为 Linux 可执行文件路径，后端仍按相同的 `--port <port>` 启动约定处理。如果 Linux 程序启动参数不同，需要在配置中显式声明 `startArgs`，不能静默猜测。

## DMAPI 代理接口

后端从 `AutoDaoMengPublic/src/DMAPI/*.py` 反推并封装以下接口：

| 能力 | 方法和路径 | 参数 |
| --- | --- | --- |
| 健康检查 | `GET /health` | 无 |
| 账号登录 | `POST /session/login` | `{ account, pwd }` |
| 恢复登录态 | `POST /session` | `{ uid, token }` |
| 导入导出 URL 登录态 | `POST /session/import-export-url` | `{ url }` |
| 可管理活动 | `GET /manage/activities` | 无 |
| 普通活动列表 | `GET /activities` | `tribeId` |
| 签到卡 ID | `GET /sign/card/:activityId` | path |
| 签到名单 | `GET /sign/list` | `activityId`, `type` |
| 补签 | `POST /sign/resign` | `{ activityId, signUpId_list, is_all }` |
| 学分项 | `GET /credit/types` | `activityId` |
| 学分项映射 | `GET /credit/types-map` | `activityId` |
| 学分名单 | `POST /credit/list` | `{ url, activityId, scoreId }` |
| 按 userId 发放 | `POST /credit/send` | `{ activityId, scoreId, userList }` |
| 按姓名发放 | `POST /credit/send-by-name` | `{ activityId, scoreId, usernameList }` |
| 按 signUpId 发放 | `POST /credit/send-by-signup-id` | `{ activityId, scoreId, signUpIdList }` |
| 查询未发 | `POST /credit/find-not-sent` | `{ activityId, scoreId, signUpId_list }` |
| 导出成员 Excel | `GET /export/members` | `activityId`, `type` |

名单常量：

- 签到类型：`unsigned=1`、`signed=2`、`signout=3`、`leave=4`
- 成员导出：`register=1`、`admit=2`、`leave=3`
- 学分名单 URL：`candidates`、`other`、`credited` 对应原项目中的三个完整 URL 常量

## 后端模块

后端按能力拆分为以下模块：

- `server/config`：读取配置、校验路径、生成默认配置。
- `server/local-api/process`：启动、健康检查和停止外部代理进程。
- `server/local-api/client`：封装代理 HTTP 请求、错误格式、敏感字段脱敏日志。
- `server/domain/excel`：解析用户上传的 xlsx，校验表头、学号、姓名、学分类型、学分数值。
- `server/domain/catalog`：拉取活动、签到卡、学分项、报名名单、录取名单、签到名单、已发名单。
- `server/domain/planner`：用 TypeScript 重写计划算法，生成 plan。
- `server/domain/executor`：按 plan 执行补签和发放，并做执行期二次校验。
- `server/domain/reports`：导出 plan、执行结果和随机消耗报表。
- `server/storage`：保存导入批次、计划、任务、操作日志。
- `server/routes`：对前端暴露 REST API。

存储第一版使用文件型 JSON 数据库和 xlsx 文件目录，便于本地部署和审计。每个计划、导入批次、执行任务都有独立 ID，所有写操作记录审计日志。后续如需多人并发或远程部署，可迁移到 SQLite，但第一版不引入数据库复杂度。

## 前端信息架构

前端默认进入实际操作台，不做营销页。

主要页面：

- 活动总览：按活动查看报名、录取、未签到、已签到、签退、请假、学分项、已发名单、未发名单。
- 导入中心：上传 xlsx，显示导入需求池，支持筛选和编辑。
- 计划中心：从导入批次生成 plan，查看 plan，细粒度调整每个学生、活动、学分项是否发放。
- 执行中心：选择 plan，执行前预检，确认后执行，实时查看补签、发放、跳过、失败、已发状态。
- 随机消耗：配置阈值、偏移、种子，生成待发清单，按活动确认执行。
- 配置页：查看代理服务状态、路径、端口、自动启动和登录态导入入口。

## 活动总览

活动总览以活动为一级对象，学分项为二级对象，人员为明细对象。

每个活动展示：

- 活动 ID、活动名、签到卡状态。
- 报名名单、录取名单、未签到、已签到、签退、请假。
- 每个学分项的学分类型、分值、总名额、已发数、剩余名额。
- 每个学分项的已发名单和未发名单。

筛选维度：

- 活动名、活动 ID
- 姓名、学号、signUpId、userId
- 学分类型
- 报名状态、签到状态、发放状态
- 是否在录取名单
- 是否有签到卡

批量选择：

- 全选当前筛选结果
- 反向选择当前筛选结果
- 全不选
- 跨页保留选择

批量操作：

- 补签选中人员
- 发放选中人员的指定学分项
- 加入计划
- 从计划候选中移除

## 导入与生成 Plan

导入 xlsx 后形成导入批次。导入批次包括原始行、聚合需求、校验错误、可编辑需求池。

支持表头：

- `学号`
- `姓名`
- `学分类型`
- `学分数值`

学分类型支持：

- `美育实践学分`
- `思想成长学分`
- `劳动教育学分`
- `体育活动学分`

`学分类型` 支持用 `,` 或 `，` 分隔多个类型，表示优先级顺序。导入后用户可以编辑学分类型顺序、学分值、是否参与计划。

必须提供两个生成入口：

- 直接生成 plan：导入完成后不做任何修改，立即生成 plan。
- 修改后生成 plan：用户筛选、编辑、勾选后生成 plan。

生成 plan 时后端执行：

1. 拉取可管理活动。
2. 过滤无签到卡活动。
3. 拉取支持的学分项。
4. 导出并解析录取名单。
5. 匹配学生姓名、学号、活动和学分类型。
6. 根据容量和分值生成分配。
7. 预读已发名单，标注已部分发放和已全部发放。
8. 保存 plan，并返回摘要和明细。

plan 生成失败时必须返回明确错误，不自动改成手动计划或空计划。

## Plan 模型

Plan 包含：

- `id`
- `name`
- `sourceImportId`
- `generatedAt`
- `status`
- `demands`
- `activities`
- `allocations`
- `preissued`
- `notInAdmitList`
- `summary`
- `auditLogs`

每个 allocation 包含：

- 学生信息：学号、姓名
- 需求：学分类型、应发值
- 计划值、偏差
- assignment 列表
- 每个 assignment 的活动、学分项、signUpId、userId、状态

计划状态：

- `draft`：可编辑，未执行。
- `ready`：已完成预检，可以执行。
- `running`：执行中。
- `completed`：执行完成。
- `failed`：执行异常结束。
- `cancelled`：用户取消未执行或执行中的任务。

已执行过的 plan 不允许直接修改。需要修改时复制为新 plan，保留原 plan 审计记录。

## 计划编辑

计划中心要支持细粒度查看和修改：

- 按人查看：某个学生所有应发、计划发、已发、未发。
- 按活动查看：某个活动中每个学分项关联哪些学生。
- 按学分类型查看：同类学分的需求、计划、偏差。
- 按异常查看：不在录取名单、少发、多发、已部分发放、已全部发放。

用户可以：

- 勾选某个学生是否参与计划。
- 勾选某个 assignment 是否执行。
- 为某个学生移除某个活动学分项。
- 为某个学生改用同学分类型的其他可用活动学分项。
- 修改学分类型优先级后重新生成 plan。
- 对选中项执行“取消计划发放”。

取消计划发放只影响未执行 plan 中的待发项，不代表撤销线上已发学分。

## 执行设计

执行前必须预检：

- plan 是否存在且状态允许执行。
- 活动是否仍有签到卡。
- 学生是否仍在录取名单。
- userId 是否有效；无效时从签到名单重新映射。
- 学分是否已发、部分已发或未发。
- 未签到人员是否需要补签。
- 学分项容量是否可能冲突。

执行时按活动和学分项分组：

1. 对仍未签到且需要发放的人员补签。
2. 对每个学分项读取已发名单。
3. 跳过已全部发放人员。
4. 标记已部分发放人员，只补发缺失学分项。
5. 调用发放接口。
6. 重新读取已发名单校验。
7. 记录成功、重试成功、容量冲突、最终失败。

执行结果要实时写入任务状态，前端可轮询或使用 SSE 展示进度。

## 报表与导出

Web 内所有内容都应先在 UI 显示，导出是补充能力。

导出文件包括：

- `plan.json`
- `plan_summary.xlsx`
- `activities.xlsx`
- `not_in_admit_list.xlsx`
- `over_issued.xlsx`
- `under_issued.xlsx`
- `already_partially_issued.xlsx`
- `already_fully_issued.xlsx`
- `execution_results.xlsx`
- `retry_results.xlsx`
- `final_student_summary.xlsx`
- 随机消耗相关 xlsx

报表字段与原项目保持语义一致，但实现使用 TypeScript xlsx 库。

## 错误处理

错误必须分层：

- 代理未启动或健康检查失败。
- 登录态失效。
- 代理接口返回失败。
- xlsx 格式错误。
- 计划生成失败。
- 执行期状态冲突。
- 写操作失败。

敏感字段如 `uid`、`token`、`api_token`、`pwd`、`account` 不进入前端明文日志，也不写入普通操作日志。

## 测试策略

后端测试：

- DMAPI 客户端路径、参数和错误映射。
- xlsx 解析和校验。
- 计划算法。
- 执行预检和执行状态机。
- 报表导出。
- 代理进程启动参数和 Linux 路径配置。

前端测试：

- 筛选和选择状态。
- 导入后直接生成 plan。
- 修改后生成 plan。
- 计划编辑。
- 执行确认和任务状态展示。

端到端测试：

- 使用 mock DMAPI 服务覆盖导入、生成 plan、执行、失败重试、报表导出。

## 分阶段交付

第一阶段：

- 项目脚手架。
- Bun 后端服务。
- DMAPI 代理进程管理和 HTTP 客户端。
- 活动总览。
- xlsx 导入。
- 导入后直接生成 plan 的 API 和 UI 入口。
- 基础计划查看和编辑。

第二阶段：

- TypeScript 计划算法完整迁移。
- 执行期二次校验。
- 执行任务、进度、结果报表。
- 活动、人、学分项多维明细。

第三阶段：

- 随机消耗。
- 更完整的报表导出。
- Linux 可执行程序部署文档。
- 端到端验证。
