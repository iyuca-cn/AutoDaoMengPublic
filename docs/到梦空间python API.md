# DMAPI 文档

## 简介

当前仓库中的 `DMAPI` 不是直接请求官方接口的一层薄封装，而是一个面向本地 `DMLocalApi` 服务的 Python 客户端。  
核心代码位于 `src/DMAPI/DMAPI.py`、`src/DMAPI/DMLocalClient.py` 和 `src/DMAPI/ServerManager.py`。

和旧版本相比，当前实现有两个关键变化：

- 不再依赖外部 `[crypto_api]` 服务。
- 默认优先连接或自动拉起本地 `dmlocalapi_server.exe`。

## 快速开始

```python
from DMAPI import DMAPI

api = DMAPI("config.ini")
activities = api.get_mime_manage_activity_dict()
```

如果只想从命令行直接调用这些上层 API，可以使用独立 CLI：

```shell
uv run src/dmapi_cli/main.py activities
uv run src/dmapi_cli/main.py sign-list --activity-id 1001 --type signed
uv run src/dmapi_cli/main.py credit-list --activity-id 1001 --score-id 2001 --kind candidates --json
```

该 CLI 位于 `src/dmapi_cli/`，复用本页说明的 `DMAPI`，不会绕过它直接访问本地 HTTP 服务。
完整命令、确认词和退出码见 [DMAPI 命令行工具说明](DMAPI命令行工具.md)。

## 初始化与本地服务行为

构造函数：

```python
DMAPI(config_path: str)
```

初始化阶段会做这些事：

- 读取 `config.ini` 中的 `[login]` 和 `[local_server]`。
- 根据配置或环境变量决定本地服务地址。
- 在未禁用自动启动时，尝试复用或拉起 `dmlocalapi_server.exe`。
- 如果本地存在 `uid/token`，会先尝试恢复登录态。
- 如果登录态失效，会提示重新登录，或让用户粘贴导出页面 URL 导入手机登录态。

本地服务配置优先级：

- `DMLOCALAPI_BASE_URL` 环境变量
- `[local_server].base_url`
- 默认值 `http://127.0.0.1:8765`

本地服务可执行文件查找顺序：

- `DMLOCALAPI_SERVER_EXE` 环境变量
- `[local_server].exe_path`
- 当前入口脚本同目录，例如 `src/` 或 `src/dmapi_cli/`
- 当前工作目录
- `src/DMAPI/`
- `src/dist/`

说明：`dmlocalapi_server.exe` 和 `dist/` 默认被 `.gitignore` 忽略。仓库可能只保留代码和文档，运行前需要确认本地已经有可执行文件，或通过 `DMLOCALAPI_SERVER_EXE` 指到实际位置。

如需禁止自动拉起本地服务，可设置：

```text
DMLOCALAPI_DISABLE_AUTOSTART=1
```

禁止自动启动后，客户端仍会按配置地址连接服务，但不会尝试寻找或启动 `dmlocalapi_server.exe`。

## 登录流程

当前支持两种登录方式：

- 账号密码登录：调用本地服务 `/session/login`
- 导出 URL 导入登录态：调用本地服务 `/session/import-export-url`

导出 URL 方式要求传入形如下面前缀的地址：

```text
https://apph5.5idream.net/apih5/api/activity/join/export?activityid=...
```

成功登录后，`uid`、`token`、`account`、`pwd` 会回写到 `config.ini`。

## 常量

签到类型：

```python
SIGN_TYPE_UNSIGNED = 1
SIGN_TYPE_SIGNED = 2
SIGN_TYPE_SIGNOUT = 3
SIGN_TYPE_LEAVE = 4
```

学分列表来源：

```python
CREDIT_URL_CANDIDATES
CREDIT_URL_OTHERMEMS
CREDIT_URL_CREDITEDMEM
```

名单导出类型：

```python
EXPORT_TYPE_REGISTER = 1
EXPORT_TYPE_ADMIT = 2
EXPORT_TYPE_LEAVE = 3
```

## 常用方法

### 登录与活动

`login(account: str, pwd: str) -> bool`

- 使用账号密码登录。
- 成功时会更新 `self.uid`、`self.token` 并回写配置文件。

`get_activityList(tribeId: str = "508956") -> bool`

- 对应本地服务 `/activities`。
- 常用于验证当前登录态是否可正常访问活动列表。

`get_mime_manage_activity_dict() -> dict | None`

- 对应本地服务 `/manage/activities`。
- 返回当前账号可管理活动的字典，键通常是 `activityId`。

`get_uid_and_token_from_export_url(url: str) -> tuple[str, str]`

- 校验导出 URL 格式。
- 交给本地服务解析并导入登录态。
- 成功后会保存到配置文件。
- URL 不合法时会抛出 `ValueError`。

### 签到相关

`get_signid(activityId: str) -> str | None`

- 读取某个活动的签到卡 ID。
- 当前规划和执行流程会用它判断活动是否具备签到卡。

`get_sign_list(activityId: str, type: int) -> list | None`

- 读取签到列表。
- 返回值里常见字段有 `signUpId`、`userId`、`name`。

`resign(activityId: str, signUpId_list: list = [], is_all: bool = True) -> bool`

- 为指定报名记录补签。
- 当前工作流执行时使用的是 `is_all=False` 的定向补签模式。
- `is_all=True` 会走“全员补签”逻辑，通常不建议在自动化流程里直接使用。

`generate_signcard(...) -> object | None`

- 对应本地服务 `/sign/card`。
- 用于生成或刷新签到卡配置。

### 学分相关

`get_creditType_list(activityId: str) -> list | None`

- 返回活动下的学分项列表。
- 当前规划逻辑主要依赖字段：
  - `creditId`
  - `scoreId`
  - `scorename`
  - `unitcount`
  - `num`
  - `providenum`

`get_creditType_list2(activityId: str) -> object | None`

- 对应本地服务 `/credit/types-map`。
- 当前源码里没有直接使用它。
- 一般可视为“由本地服务整理后的学分项映射”，具体结构以服务返回为准。

`get_credit_list(url: str, activityId: str, scoreId: str) -> list | None`

- 读取学分相关人员列表。
- `url` 需要传入 `CREDIT_URL_*` 常量之一。

`send_credit(activityId: str, scoreId: str, userList: str) -> bool`

- 底层发放接口，对应本地服务 `/credit/send`。
- `userList` 必须是逗号分隔的 `userId` 字符串。
- 传空字符串会直接抛出 `ValueError`。

`send_creditByname(activityId: str, scoreId: str, usernameList: list) -> object | None`

- 按姓名发放学分。
- 由于姓名可能重名，当前自动化主流程没有使用它。

`send_creditBy_signUpId(activityId: str, scoreId: str, signUpIdList: list) -> object | tuple[bool, list] | None`

- 按 `signUpId` 发放学分。
- 当前返回值取决于本地服务实现；若服务返回两段列表，客户端会整理成二元组。

`find_not_send_credited_mem_by_signUpId(activityId: str, scoreId: str, signUpId_list: list) -> tuple[dict, dict]`

- 查询未发放成功的报名记录。
- 若本地服务未返回预期结构，会退回空字典。

### 导出相关

`export_mem_excel(activityId: str, type: int) -> bytes | None`

- 导出报名、录取或请假名单的 Excel 二进制内容。
- 当前规划与执行流程主要依赖 `EXPORT_TYPE_ADMIT`。

## 返回值与错误约定

当前 `DMAPI` 的风格不是统一抛异常，而是混合以下约定：

- 成功时返回 `dict`、`list`、`bytes`、`tuple` 或 `True`
- 失败时常返回 `None`、`False`、空结构
- 参数明显非法时，个别方法会抛 `ValueError`

如果你直接调用 `DMAPI`，建议始终显式检查返回值。

## 示例

```python
from DMAPI import DMAPI

api = DMAPI("config.ini")
activities = api.get_mime_manage_activity_dict() or {}

for activity_id, activity in activities.items():
    sign_id = api.get_signid(str(activity_id))
    credit_rows = api.get_creditType_list(str(activity_id)) or []
    print(activity.get("name"), sign_id, len(credit_rows))
```

## 与主工作流的关系

当前仓库的两个主流程都依赖 `DMAPI`：

- `credit_workflow`：生成计划、执行补签和发放
- `random_drain`：随机消耗剩余可发名额

它们不会直接访问官方 HTTP 接口，而是统一走本地 `DMLocalApi`。

`src/dmapi_cli/main.py` 是面向人工或脚本的直接操作入口，适合查询活动、签到名单、学分项、导出名单，以及在明确确认后执行补签或发放。它和 `src/main.py` 的批处理工作流相互独立。

