# DMapi 调用日志设计

## 背景

当前仓库内已有基于 `loguru` 的日志配置模块 `src/log/log.py`，但 `DMAPI` 与命令行工作流并未统一接入这套日志。与此同时，现有文档已经明确提醒历史日志中曾出现明文 `uid`、`token`、`api_token` 和请求载荷残留，因此新增 DMapi 调用日志时必须把“可排障”和“默认脱敏”同时作为目标。

## 目标

- 为 `DMAPI` 发起的本地接口调用补充统一日志。
- 记录调用方法名、HTTP 方法、路由、耗时、成功/失败状态。
- 默认记录脱敏后的请求参数摘要与响应摘要，不记录原始敏感凭证。
- 不改变现有 `DMAPI` 返回值语义与异常处理行为。

## 方案

### 1. 调用入口分层

- `src/DMAPI/DMAPI.py` 负责为每个公开方法传入业务语义明确的 `operation` 名称。
- `src/DMAPI/DMLocalClient.py` 负责统一完成日志记录、耗时统计、脱敏和错误摘要。

这样既能保留 `send_credit`、`get_sign_list`、`export_mem_excel` 这类上层语义，又避免在多个业务方法里复制日志代码。

### 2. 日志内容

每次调用记录两类日志：

- 请求开始日志：`operation`、HTTP 方法、路由、脱敏后的 `params/json` 摘要。
- 请求结束日志：`operation`、HTTP 状态码、耗时、成功/失败状态、响应摘要或错误摘要。

字节流接口只记录内容类型和字节数，不写入原始二进制。

### 3. 脱敏规则

默认对以下内容做脱敏或结构化摘要：

- `uid`、`token`、`api_token`、`pwd`、`account`
- `userList`、`usernameList`、`signUpIdList`、`signUpId_list`
- 导出链接 `url`

规则如下：

- 凭证类字段仅保留少量首尾字符，中间打码。
- 用户列表类字段仅记录数量和少量脱敏样本。
- URL 仅记录主机、路径和 query key 列表，不记录原始 query value。
- 响应体只记录结构摘要，例如字典键集合、列表长度、布尔值、字节数等。

## 错误处理

- 网络异常、非 JSON 返回和本地接口业务失败都记录失败日志。
- `DMLocalClient` 仍按现有逻辑抛出 `LocalApiError`。
- `DMAPI` 仍按现有逻辑决定返回 `False`、`None` 或继续抛出 `ValueError`，保证上层工作流行为不变。

## 影响文件

- `src/DMAPI/DMLocalClient.py`
- `src/DMAPI/DMAPI.py`
- `src/log/log.py`
- `tests/test_dmapi_client_mapping.py`
- 新增 `tests/test_dmapi_logging.py`
- `docs/日志模块.md`

## 验证

- 为 `DMLocalClient` 增加日志单测，验证成功日志、失败日志和 URL 脱敏。
- 复跑现有 `DMAPI` 映射测试，确认参数透传和返回值语义不变。
- 必要时补充日志文档，说明 `DMAPI` 已接入日志模块且默认脱敏。
