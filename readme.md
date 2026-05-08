# AutoDaoMengPublic

用于到梦空间活动的自动补签、学分/学时计划生成与执行，以及按阈值随机消耗剩余可发名额。

## 功能概览

- `plan`：读取 Excel 需求表，结合当前活动、录取名单和学分项状态生成冻结计划。
- `execute`：基于 `plan.json` 二次校验后执行补签和发放，并输出执行报表。
- `random-drain`：按活动学分项的目标发放人数阈值随机挑选候选人，逐活动确认后执行。
- `DMAPI`：当前版本通过本地 `DMLocalApi` 服务完成登录态导入、签到、名单读取和学分发放。

## 快速开始

本项目使用 [uv](https://docs.astral.sh/uv/) 管理依赖。

```shell
uv sync
```

生成计划：

```shell
uv run src/main.py plan --excel /path/to/input.xlsx --output /path/to/output
```

执行计划：

```shell
uv run src/main.py execute --plan /path/to/output/<batch>/plan.json
```

随机消耗剩余名额：

```shell
uv run src/main.py random-drain --threshold-percent 90 --jitter-count 5 --output logs/random-drain
```

直接调用 DMAPI：

```shell
uv run src/dmapi_cli/main.py activities
uv run src/dmapi_cli/main.py credit-types --activity-id 1001
uv run src/dmapi_cli/main.py export-members --activity-id 1001 --type admit --output logs/admit.xlsx
```

更多命令、确认词和 JSON 输出说明见 [DMAPI 命令行工具说明](docs/DMAPI命令行工具.md)。

## 当前版本的重要行为

- 首次运行会按提示创建或补全 `config.ini`。
- 已不再依赖旧的 `[crypto_api]` 外部加解密服务。
- 程序默认会尝试连接或启动本地 `DMLocalApi` 服务。
- `execute` 必须输入精确确认词 `EXECUTE` 才会真正执行。
- `random-drain` 会逐活动要求输入 `EXECUTE <activityId>` 才会执行该活动。
- 直接 DMAPI CLI 位于 `src/dmapi_cli/`，会复用 `DMAPI` 的登录态、配置和本地服务管理；`resign`、`send-credit`、`send-credit-signup` 默认要求精确确认，确认词形如 `EXECUTE send-credit 1001 2`。

## Excel 输入要求

需求表必须包含这 4 个表头，列顺序可以任意调整：

- `学号`
- `姓名`
- `学分类型`
- `学分数值`

支持的学分类型当前只有：

- `美育实践学分`
- `思想成长学分`
- `劳动教育学分`
- `体育活动学分`

`学分类型` 一列支持用 `,` 或 `，` 写多个类型，表示优先级回退顺序。例如：

```text
劳动教育学分，美育实践学分
```

表示先尝试劳动教育学分，不足时再回退到美育实践学分补足同一条需求。

## 本地服务与配置

- 默认本地服务地址是 `http://127.0.0.1:8765`。
- 可通过环境变量 `DMLOCALAPI_BASE_URL` 指向已运行服务。
- 可通过环境变量 `DMLOCALAPI_SERVER_EXE` 指定 `dmlocalapi_server.exe`。
- 可通过环境变量 `DMLOCALAPI_DISABLE_AUTOSTART=1` 禁止自动拉起本地服务。
- 程序会在 `src/dist/dmlocalapi_server.exe` 等位置查找服务端可执行文件；该文件被 `.gitignore` 忽略，缺失时需要手动下载后放入本地。

下载地址：

`https://wwboi.lanzoue.com/b016krxmwd`
`密码:awxr`

## 输出产物

`plan` 会在输出目录下生成一个批次目录，默认命名为 `<Excel文件名>_YYYY-MM-DD_HHMMSS`，常见文件包括：

- `plan.json`
- `plan_summary.xlsx`
- `activities.xlsx`
- `not_in_admit_list.xlsx`
- `over_issued.xlsx`
- `under_issued.xlsx`
- `already_partially_issued.xlsx`
- `already_fully_issued.xlsx`

`execute` 会在同一批次目录继续写入：

- `execution_results.xlsx`
- `retry_results.xlsx`
- `final_student_summary.xlsx`
- `activities/<activityId>_<活动名>/...`

其中 `execution_results.xlsx` 按工作表拆分补签成功、发放成功、执行期不在录取名单、执行期容量冲突、已部分发放、已全部发放和发放最终失败。

`random-drain` 会生成独立时间戳目录，包含：

- `random_drain_summary.xlsx`
- `random_drain_successes.xlsx`
- `random_drain_failures.xlsx`
- `random_drain_skipped.xlsx`

## 安全提醒

- `config.ini` 会保存登录态和账号信息，请不要外传。
- 仓库根目录现有的 `logs/*.log` 运行日志中已经发现明文 `uid`、`token`、`api_token` 和请求载荷残留，分享日志前请先清理或脱敏。

## 文档索引

- [配置文件说明](docs/配置文件.md)
- [DMAPI 说明](<docs/到梦空间python API.md>)
- [DMAPI 命令行工具说明](docs/DMAPI命令行工具.md)
- [命令行工作流说明](docs/命令行工作流.md)
- [日志模块说明](docs/日志模块.md)

## 许可证

本项目仅供学习和研究使用。

不要想着通过本项目了解加密方法，我仅提供了上面这些合理诉求所需的API的调用方法，不暴露内部的加解密方法，且内部实现的加密方法逆向起来要比官方要难得多。
