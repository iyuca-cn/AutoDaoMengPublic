# 跨活动操作计划与流式执行 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit unless the user explicitly asks.

**Goal:** Add failed-plan re-execution, cross-activity operation plans, and streaming progress for slow activity detail, precheck, and execution calls.

**Architecture:** Keep JSON endpoints for compatibility and add NDJSON stream endpoints for slow work. Expand operation actions to carry their own activity context so one operation plan can safely span multiple activities. Execution center always creates a new task for each run and requires a fresh precheck, including failed-plan reruns.

**Tech Stack:** Bun, TypeScript, Vite, Vue 3, TailwindCSS, Vitest.

---

## File Structure

- Modify: `server/domain/models.ts` for action-level activity fields and multi-activity plan metadata.
- Modify: `src/types.ts` to mirror cross-activity plan and stream event types.
- Modify: `server/domain/operationPlans.ts` to create single and cross-activity operation plans.
- Modify: `server/domain/operationExecutor.ts` to precheck and execute by each action's activity.
- Modify: `server/domain/taskRunner.ts` and `server/domain/operationTaskRunner.ts` to allow rerunning failed plans and emit task snapshots.
- Modify: `server/http.ts` to add NDJSON stream helpers.
- Modify: `server/routes/activityRoutes.ts` for streamed single and batch detail endpoints.
- Modify: `server/routes/taskRoutes.ts` for streamed credit plan precheck and execute endpoints.
- Modify: `server/routes/operationPlanRoutes.ts` for streamed operation plan precheck and execute endpoints.
- Modify: `src/api.ts` to add `apiStream`.
- Modify: `src/views/ActivityOverview.vue` for streamed detail loading and multi-activity detail mode.
- Create: `src/components/MultiActivityDetail.vue` for grouped cross-activity selection and plan creation.
- Modify: `src/components/OperationPlanCreator.vue` if needed for shared create payload semantics.
- Modify: `src/views/ExecutionCenter.vue` to list failed plans and stream precheck/execute progress.
- Modify: `src/views/PlanCenter.vue` and `src/components/OperationPlanTable.vue` to display cross-activity metadata.
- Modify: `tests/server/operationPlans.test.ts`.
- Modify: `tests/server/operationExecutor.test.ts`.
- Modify: `tests/server/routes.test.ts` or add focused route tests for streaming.

---

## Chunk 1: Cross-Activity Operation Model

### Task 1: Add Activity Context to Actions

**Files:**
- Modify: `server/domain/models.ts`
- Modify: `src/types.ts`

- [ ] Add optional `activityIds` and `activityNames` to `OperationPlan`.
- [ ] Add required `activityId` and `activityName` to `OperationAction`.
- [ ] Keep existing top-level `activityId` and `activityName` for old data compatibility.
- [ ] Run `bun run typecheck`.

### Task 2: Create Cross-Activity Plans

**Files:**
- Modify: `server/domain/operationPlans.ts`
- Modify: `tests/server/operationPlans.test.ts`

- [ ] Extend create input to accept `activitySelections`.
- [ ] Write a test that one plan can include actions from two activities.
- [ ] Normalize plan metadata from action activity IDs.
- [ ] Preserve old single-activity create input.
- [ ] Run `bun run test tests/server/operationPlans.test.ts`.

### Task 3: Execute by Action Activity

**Files:**
- Modify: `server/domain/operationExecutor.ts`
- Modify: `tests/server/operationExecutor.test.ts`

- [ ] Write a test proving precheck calls sign and credit APIs with each action's own activity ID.
- [ ] Write a test proving execution sends credit and resign calls to the action activity ID.
- [ ] Cache credited lists by `activityId:creditId`.
- [ ] Use top-level plan activity only as legacy fallback.
- [ ] Run `bun run test tests/server/operationExecutor.test.ts`.

---

## Chunk 2: Stream Infrastructure

### Task 4: Add NDJSON Helpers

**Files:**
- Modify: `server/http.ts`

- [ ] Add `StreamEvent` type.
- [ ] Add `ndjsonStream(handler)` helper.
- [ ] Ensure thrown errors emit an `error` event with message and code.
- [ ] Keep CORS behavior unchanged.

### Task 5: Add Frontend Stream Client

**Files:**
- Modify: `src/api.ts`
- Modify: `src/types.ts`

- [ ] Add stream event types.
- [ ] Implement `apiStream(path, options)` with incremental text decoding.
- [ ] Dispatch unauthorized events when stream error status is `401`.
- [ ] Keep existing JSON helpers unchanged.
- [ ] Run `bun run typecheck`.

---

## Chunk 3: Streamed Activity Details

### Task 6: Add Stream Routes for Activity Detail

**Files:**
- Modify: `server/routes/activityRoutes.ts`
- Modify: `tests/server/routes.test.ts`

- [ ] Add `GET /api/activities/:id/stream`.
- [ ] Add `POST /api/activities/details/stream` accepting `{ activityIds: string[] }`.
- [ ] Emit progress before and after each activity detail read.
- [ ] For batch details, include per-activity errors instead of pretending success.
- [ ] Run focused route tests.

### Task 7: Add Multi-Activity Detail UI

**Files:**
- Create: `src/components/MultiActivityDetail.vue`
- Modify: `src/views/ActivityOverview.vue`

- [ ] Use stream loading for single activity detail.
- [ ] Add multi-select “查看详情” behavior.
- [ ] Render grouped activity detail with per-activity loading and error state.
- [ ] Support selecting members and credit items per activity.
- [ ] Generate one cross-activity operation plan from selected groups.
- [ ] Run `bun run typecheck`.

---

## Chunk 4: Streamed Precheck, Execution, and Rerun

### Task 8: Allow Failed Plan Reruns

**Files:**
- Modify: `server/domain/taskRunner.ts`
- Modify: `server/domain/operationTaskRunner.ts`
- Modify: `server/routes/taskRoutes.ts`
- Modify: `server/routes/operationPlanRoutes.ts`

- [ ] Allow `failed` plans in precheck and run guards.
- [ ] Ensure every rerun creates a new task.
- [ ] Update audit logs for rerun starts and completions.
- [ ] Keep completed/running/cancelled locked.

### Task 9: Add Streamed Precheck and Execute Routes

**Files:**
- Modify: `server/routes/taskRoutes.ts`
- Modify: `server/routes/operationPlanRoutes.ts`
- Modify: `server/domain/taskRunner.ts`
- Modify: `server/domain/operationTaskRunner.ts`

- [ ] Add credit plan precheck and execute stream routes.
- [ ] Add operation plan precheck and execute stream routes.
- [ ] Emit task snapshots as events are written.
- [ ] Emit final completed data.
- [ ] Run server tests.

### Task 10: Update Execution Center

**Files:**
- Modify: `src/views/ExecutionCenter.vue`

- [ ] Include `failed` in executable plans.
- [ ] Clear stale precheck when plan changes.
- [ ] Use streamed precheck and execute endpoints.
- [ ] Show streaming progress while waiting.
- [ ] Label failed-plan execution as “重新执行”.
- [ ] Run `bun run typecheck`.

---

## Chunk 5: Verification

### Task 11: Full Test Pass

**Files:**
- No code files expected.

- [ ] Run `bun run test`.
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run build`.
- [ ] Start dev server if UI verification is needed.
- [ ] Inspect the changed screens for obvious layout overflow.
