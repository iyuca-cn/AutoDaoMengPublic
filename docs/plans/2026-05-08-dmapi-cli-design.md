# DMAPI CLI 设计

## 背景

当前项目已有 `src/main.py` 提供 `plan`、`execute`、`random-drain` 三个业务工作流命令，也已有 `src/DMAPI` 封装本地 `DMLocalApi` 服务的登录、服务启动、活动、签到、学分和导出能力。

本次新增一个独立 CLI，用来直接调用 `DMAPI` 暴露的上层 API。它不替代现有业务工作流，也不直接绕过 `DMAPI` 请求本地 HTTP 服务。

## 目标

- 在独立目录中提供直接 API 操作 CLI。
- 复用现有 `DMAPI` 的配置、登录态恢复、本地服务自动启动和返回值语义。
- 支持查询活动、签到卡、签到名单、学分项、学分名单、导出名单、补签和发放学分。
- 危险写操作必须显式确认，避免误操作线上数据。
- 提供默认文本输出和脚本友好的 JSON 输出。

## 非目标

- 不改造 `src/main.py` 的 `plan`、`execute`、`random-drain`。
- 不绕过 `DMAPI` 直接访问本地 HTTP API。
- 不引入新的命令行框架依赖。
- 不增加兜底执行路径；失败时输出明确原因并返回非零退出码。

## 架构

新增目录 `src/dmapi_cli/`，所有 CLI 专属代码都放在该目录中。

- `src/dmapi_cli/main.py`：命令行入口、参数定义、命令分发和退出码处理。
- `src/dmapi_cli/output.py`：文本和 JSON 输出格式化。
- `src/dmapi_cli/__init__.py`：包声明。

CLI 内部实例化 `DMAPI(config_path)`，再调用现有公开方法。配置路径默认仍为 `config.ini`，通过全局参数 `--config` 覆盖。

## 命令

- `activities`：查看可管理活动。
- `sign-id --activity-id`：查看活动签到卡 ID。
- `sign-list --activity-id --type unsigned|signed|signout|leave`：查看签到名单。
- `credit-types --activity-id`：查看活动学分项。
- `credit-list --activity-id --score-id --kind candidates|other|credited`：查看学分相关名单。
- `export-members --activity-id --type register|admit|leave --output <path>`：导出成员 Excel。
- `resign --activity-id (--signup-id ... | --all)`：补签。
- `send-credit --activity-id --score-id --user-id ...`：按 userId 发放学分。
- `send-credit-signup --activity-id --score-id --signup-id ...`：按 signUpId 发放学分。
- `import-export-url --url <url>`：导入手机登录态。

## 确认与错误处理

`resign`、`send-credit`、`send-credit-signup` 是写操作，默认要求输入精确确认词。确认词包含操作名、活动 ID 和目标数量。传入 `--yes` 可跳过交互确认，方便明确受控的脚本调用。

错误处理保持显式：

- `ValueError` 输出错误信息并返回 `2`。
- `DMAPI` 返回 `None` 或 `False` 时输出命令级失败信息并返回 `1`。
- 参数错误由 `argparse` 处理。

## 输出

默认文本输出面向人工查看，展示摘要和关键字段。传入 `--json` 后输出 JSON，保留原始返回数据并包一层命令结果结构。

Excel 导出写入 `--output` 指定路径，成功时输出写入路径和字节数。

## 测试

- 覆盖 parser 和命令分发。
- 使用 Stub DMAPI 验证每个命令调用正确方法和参数。
- 覆盖 JSON 输出。
- 覆盖写操作确认取消、确认通过和 `--yes`。
- 覆盖导出文件写入。
