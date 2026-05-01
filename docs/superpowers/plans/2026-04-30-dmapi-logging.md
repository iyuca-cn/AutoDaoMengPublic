# DMapi Logging Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DMapi 本地接口调用增加默认脱敏的请求/响应摘要日志，同时保持现有返回值与异常语义不变。

**Architecture:** `DMAPI.py` 为每个公开调用透传 `operation` 名称，`DMLocalClient.py` 统一负责日志记录、耗时统计、脱敏和错误摘要。继续复用 `src/log/log.py` 的 `loguru` 配置，并同步修正文档中关于日志接入状态的说明。

**Tech Stack:** Python 3.12, requests, loguru, pytest

---

## File Map

- Modify: `src/DMAPI/DMLocalClient.py`
- Modify: `src/DMAPI/DMAPI.py`
- Modify: `src/log/log.py`
- Modify: `docs/日志模块.md`
- Modify: `tests/test_dmapi_client_mapping.py`
- Create: `tests/test_dmapi_logging.py`

## Chunk 1: Logging Core

### Task 1: 在 `DMLocalClient` 中补齐脱敏与日志工具

**Files:**
- Modify: `src/DMAPI/DMLocalClient.py`
- Test: `tests/test_dmapi_logging.py`

- [ ] **Step 1: 写失败测试，覆盖成功日志和敏感字段脱敏**

```python
def test_json_request_logs_masked_request_and_response_summary():
    ...
```

- [ ] **Step 2: 运行单测确认当前失败**

Run: `uv run pytest tests/test_dmapi_logging.py -v`
Expected: FAIL，因为日志辅助能力和 `operation` 透传尚不存在。

- [ ] **Step 3: 实现最小日志核心**

```python
def _log_request_start(...):
    ...

def _log_request_success(...):
    ...

def _summarize_payload(...):
    ...
```

- [ ] **Step 4: 运行单测确认通过**

Run: `uv run pytest tests/test_dmapi_logging.py -v`
Expected: PASS

- [ ] **Step 5: 提交当前改动**

```bash
git add src/DMAPI/DMLocalClient.py tests/test_dmapi_logging.py
git commit -m "feat: add dmapi request logging core"
```

## Chunk 2: Operation 透传

### Task 2: 为 `DMAPI` 公开方法传入语义化 operation 名称

**Files:**
- Modify: `src/DMAPI/DMAPI.py`
- Test: `tests/test_dmapi_client_mapping.py`

- [ ] **Step 1: 写或调整测试，确认现有行为不变**

```python
def test_get_activity_list_maps_to_local_route():
    ...
```

- [ ] **Step 2: 运行相关测试确认基线**

Run: `uv run pytest tests/test_dmapi_client_mapping.py -v`
Expected: PASS 或仅因 `operation` 尚未接线导致新断言失败。

- [ ] **Step 3: 在 `DMAPI` 中统一传入 operation**

```python
self._client.post("/credit/send", payload, operation="send_credit")
```

- [ ] **Step 4: 运行相关测试确认通过**

Run: `uv run pytest tests/test_dmapi_client_mapping.py tests/test_dmapi_logging.py -v`
Expected: PASS

- [ ] **Step 5: 提交当前改动**

```bash
git add src/DMAPI/DMAPI.py tests/test_dmapi_client_mapping.py tests/test_dmapi_logging.py
git commit -m "feat: wire dmapi operations into request logs"
```

## Chunk 3: 文档与回归

### Task 3: 更新日志文档并完成回归验证

**Files:**
- Modify: `src/log/log.py`
- Modify: `docs/日志模块.md`
- Modify: `docs/plans/2026-04-30-dmapi-logging-design.md`

- [ ] **Step 1: 修正日志目录与文档说明**

```python
log_path.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 2: 运行针对性测试**

Run: `uv run pytest tests/test_dmapi_client_mapping.py tests/test_dmapi_logging.py -v`
Expected: PASS

- [ ] **Step 3: 运行全量测试**

Run: `uv run pytest -q`
Expected: PASS

- [ ] **Step 4: 提交最终改动**

```bash
git add src/log/log.py docs/日志模块.md docs/plans/2026-04-30-dmapi-logging-design.md docs/superpowers/plans/2026-04-30-dmapi-logging.md
git commit -m "feat: log dmapi calls with redacted summaries"
```
