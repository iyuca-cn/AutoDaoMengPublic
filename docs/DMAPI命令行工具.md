# DMAPI 命令行工具说明

`src/dmapi_cli/main.py` 是一个直接调用 `DMAPI` 上层方法的命令行入口，适合临时查询活动、签到名单、学分项、导出成员名单，以及在明确确认后执行少量写操作。

它复用 `DMAPI(config.ini)` 的登录态恢复、本地服务自动启动、配置读取和返回值语义，不会绕过 `DMAPI` 直接请求本地 HTTP 服务。

## 全局参数

命令格式：

```shell
uv run src/dmapi_cli/main.py [--config config.ini] [--json] <command> ...
```

- `--config`：配置文件路径，默认 `config.ini`。
- `--json`：以 JSON 输出结果。所有子命令也支持把 `--json` 放在子命令参数后面。

示例：

```shell
uv run src/dmapi_cli/main.py --config config.ini activities
uv run src/dmapi_cli/main.py sign-id --activity-id 1001 --json
```

## 只读命令

### `activities`

查看当前账号可管理活动：

```shell
uv run src/dmapi_cli/main.py activities
```

### `sign-id`

查看活动签到卡 ID：

```shell
uv run src/dmapi_cli/main.py sign-id --activity-id 1001
```

### `sign-list`

查看签到名单：

```shell
uv run src/dmapi_cli/main.py sign-list --activity-id 1001 --type signed
```

`--type` 可选值：

- `unsigned`：未签到
- `signed`：已签到
- `signout`：签退
- `leave`：请假

### `credit-types`

查看活动学分项：

```shell
uv run src/dmapi_cli/main.py credit-types --activity-id 1001
```

常见字段包括 `scoreId`、`creditId`、`scorename`、`unitcount`、`num`、`providenum`。

### `credit-list`

查看学分相关名单：

```shell
uv run src/dmapi_cli/main.py credit-list --activity-id 1001 --score-id 2001 --kind candidates
```

`--kind` 可选值：

- `candidates`：可发候选名单
- `other`：其他成员名单
- `credited`：已发放名单

### `import-export-url`

导入“管理活动 -> 人员管理 -> 导出”后跳转到浏览器的 URL 中的登录态：

```shell
uv run src/dmapi_cli/main.py import-export-url --url "https://apph5.5idream.net/apih5/api/activity/join/export?activityid=..."
```

输出只会显示是否保存了 token，不会打印原始 token。

## 导出命令

### `export-members`

导出成员 Excel：

```shell
uv run src/dmapi_cli/main.py export-members --activity-id 1001 --type admit --output logs/admit.xlsx
```

`--type` 可选值：

- `register`：报名名单
- `admit`：录取名单
- `leave`：请假名单

命令会自动创建输出文件的父目录。

## 写操作命令

以下命令会修改线上数据，默认都需要输入精确确认词。确认词格式为：

```text
EXECUTE <command> <activityId> <count>
```

传入 `--yes` 可以跳过确认，建议只在已经人工确认参数的脚本中使用。

### `resign`

按报名记录补签：

```shell
uv run src/dmapi_cli/main.py resign --activity-id 1001 --signup-id 9001 9002
```

确认词示例：

```text
EXECUTE resign 1001 2
```

全员补签：

```shell
uv run src/dmapi_cli/main.py resign --activity-id 1001 --all
```

全员补签确认词中的数量为 `all`：

```text
EXECUTE resign 1001 all
```

### `send-credit`

按 `userId` 发放学分：

```shell
uv run src/dmapi_cli/main.py send-credit --activity-id 1001 --score-id 2001 --user-id u-1 u-2
```

确认词示例：

```text
EXECUTE send-credit 1001 2
```

### `send-credit-signup`

按 `signUpId` 发放学分：

```shell
uv run src/dmapi_cli/main.py send-credit-signup --activity-id 1001 --score-id 2001 --signup-id 9001 9002
```

确认词示例：

```text
EXECUTE send-credit-signup 1001 2
```

## 输出与退出码

- 成功返回 `0`。
- 用户取消写操作或 `DMAPI` 返回失败时返回 `1`。
- 参数解析错误、导出 URL 校验失败等用法错误返回 `2`。
- 文本输出会优先展示常用字段；需要保留完整结构时使用 `--json`。

## 和主工作流的区别

- `src/main.py plan/execute/random-drain` 是批处理工作流，会生成计划、报表并带有更完整的执行期校验。
- `src/dmapi_cli/main.py` 是直接操作工具，只做单个 API 级别的查询、导出或写操作。
- 大批量补签和发放仍建议优先走 `plan` 与 `execute`，把 `DMAPI CLI` 作为排查和少量手工操作入口。
