# 登录与活动操作计划 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit unless the user explicitly asks.

**Goal:** Add login, optional `uid/token` persistence, activity detail views, and operation plans for resign and credit issue actions.

**Architecture:** Vue calls only the Bun backend. The backend manages session state, restores the DM local proxy session, aggregates activity detail data, stores operation plans in JSON, and executes all write operations through prechecked tasks. Activity UI actions create plans first; they never call write endpoints directly.

**Tech Stack:** Bun, TypeScript, Vite, Vue 3, TailwindCSS, Vitest, Playwright-style browser verification when running the UI.

---

## File Structure

- Modify: `server/domain/models.ts` for session, activity detail, operation plan, and task target types.
- Create: `server/domain/session.ts` for in-memory and persisted session handling.
- Create: `server/domain/activityDetail.ts` for activity detail aggregation.
- Create: `server/domain/operationPlans.ts` for creating and updating operation plans.
- Create: `server/domain/operationExecutor.ts` for precheck and execution logic.
- Modify: `server/storage/jsonStore.ts` to support `sessions` or direct session file helpers and `operation-plans`.
- Create: `server/routes/sessionRoutes.ts` for login, URL import, restore, status, and logout.
- Create: `server/routes/operationPlanRoutes.ts` for operation plan CRUD, precheck, and execution.
- Modify: `server/routes/activityRoutes.ts` to add activity detail and refresh endpoints.
- Modify: `server/routes/taskRoutes.ts` if tasks need a `targetType`.
- Modify: `server/routes/router.ts` to register new routes.
- Modify: `server/index.ts` to initialize session manager in route context.
- Modify: `server/routes/context.ts` to expose session manager.
- Modify: `server/local-api/client.ts` to expand sensitive URL summarization if needed.
- Create: `tests/server/session.test.ts`.
- Create: `tests/server/activityDetail.test.ts`.
- Create: `tests/server/operationPlans.test.ts`.
- Create: `tests/server/operationExecutor.test.ts`.
- Modify: `tests/server/routes.test.ts`.
- Modify: `src/types.ts` for session, activity detail, operation plan, and precheck types.
- Modify: `src/api.ts` if `DELETE` helper is needed.
- Modify: `src/App.vue` for session loading and login gate.
- Create: `src/views/LoginView.vue` or `src/components/SessionPanel.vue`.
- Modify: `src/views/SettingsView.vue` to show login/session controls or link to login state.
- Modify: `src/views/ActivityOverview.vue` for activity detail selection and plan actions.
- Create: `src/components/ActivityDetail.vue`.
- Create: `src/components/ActivityMemberTable.vue`.
- Create: `src/components/CreditIssueTable.vue`.
- Create: `src/components/OperationPlanCreator.vue`.
- Modify: `src/views/PlanCenter.vue` to include operation plans.
- Create: `src/components/OperationPlanTable.vue`.
- Modify: `src/views/ExecutionCenter.vue` to support operation plans.
- Modify: `src/style.css` only if shared controls need stable layout support.

---

## Chunk 1: Session Backend

### Task 1: Define Session Types

**Files:**
- Modify: `server/domain/models.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Add backend session types**

Add:

```ts
export type SessionSource = "account" | "exportUrl";

export interface StoredSession {
  uid: string;
  token: string;
  source: SessionSource;
  savedAt: string;
  lastVerifiedAt?: string;
}

export interface SessionStatus {
  authenticated: boolean;
  source?: SessionSource;
  savedAt?: string;
  lastVerifiedAt?: string;
}
```

- [ ] **Step 2: Add frontend session types**

Mirror only safe public fields in `src/types.ts`; do not expose `uid` or `token` to the UI type.

- [ ] **Step 3: Run typecheck**

Run:

```powershell
bun run typecheck
```

Expected: existing UI still typechecks.

### Task 2: Implement Session Manager

**Files:**
- Create: `server/domain/session.ts`
- Modify: `server/storage/jsonStore.ts`
- Test: `tests/server/session.test.ts`

- [ ] **Step 1: Write tests for persisted session shape**

Test that `persist=true` writes only `uid`, `token`, `source`, `savedAt`, and optional `lastVerifiedAt`.

- [ ] **Step 2: Write tests that account and password are never persisted**

Simulate account login with `{ account, pwd, persist: true }`; assert the stored JSON does not include `account` or `pwd`.

- [ ] **Step 3: Implement session storage**

Use `data/session/session.json` or a typed store helper. Keep writes atomic.

- [ ] **Step 4: Implement in-memory session**

When `persist=false`, keep `uid/token` only in the `SessionManager` instance.

- [ ] **Step 5: Implement URL validation**

Accept only URLs with prefix:

```text
https://apph5.5idream.net/apih5/api/activity/join/export?activityid=
```

Require query key `api_token` with a non-empty value.

- [ ] **Step 6: Run session tests**

Run:

```powershell
bun run test tests/server/session.test.ts
```

Expected: session persistence and validation tests pass.

### Task 3: Add Session Routes

**Files:**
- Create: `server/routes/sessionRoutes.ts`
- Modify: `server/routes/context.ts`
- Modify: `server/routes/router.ts`
- Modify: `server/index.ts`
- Test: `tests/server/routes.test.ts`

- [ ] **Step 1: Add route tests**

Cover:

- `GET /api/session`
- `POST /api/session/login`
- `POST /api/session/import-export-url`
- `POST /api/session/restore`
- `DELETE /api/session`

- [ ] **Step 2: Implement `GET /api/session`**

Return safe `SessionStatus`. If saved session exists, try restore and verification.

- [ ] **Step 3: Implement account login**

Read `{ account, pwd, persist }`, call `context.localApiClient.login`, then save only `uid/token` when requested.

- [ ] **Step 4: Implement URL login**

Validate URL locally, call `context.localApiClient.importExportUrl`, then save only `uid/token` when requested.

- [ ] **Step 5: Implement restore and logout**

Restore uses stored or memory session. Logout deletes persisted session and clears memory session.

- [ ] **Step 6: Register route**

Add `handleSessionRoutes` before activity routes in `server/routes/router.ts`.

- [ ] **Step 7: Run route tests**

Run:

```powershell
bun run test tests/server/routes.test.ts tests/server/session.test.ts
```

Expected: all session and route tests pass.

---

## Chunk 2: Login UI

### Task 4: Build Login View

**Files:**
- Create: `src/views/LoginView.vue`
- Modify: `src/api.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Add `apiDelete` helper**

Implement a typed DELETE helper in `src/api.ts`.

- [ ] **Step 2: Build two login modes**

Create tabs for:

- 账号密码
- URL 提取

Each mode includes a `persist` checkbox. The account form must not store the password anywhere outside component state.

- [ ] **Step 3: Add login calls**

Call:

- `POST /api/session/login`
- `POST /api/session/import-export-url`

Expected response updates session state in parent component.

- [ ] **Step 4: Add error display**

Show route error messages directly. Do not mask them as generic failure unless the backend message is empty.

### Task 5: Add App Session Gate

**Files:**
- Modify: `src/App.vue`
- Modify: `src/views/SettingsView.vue`

- [ ] **Step 1: Load session status on mount**

Call `GET /api/session` before showing activity operations.

- [ ] **Step 2: Show login view when unauthenticated**

Keep backend health indicator visible. Render `LoginView` in the main area until authenticated.

- [ ] **Step 3: Add session status in header**

Show logged-in source and last verification time. Do not display token.

- [ ] **Step 4: Add logout**

Call `DELETE /api/session`, clear app session, and return to login view.

- [ ] **Step 5: Run typecheck**

Run:

```powershell
bun run typecheck
```

Expected: no TypeScript errors.

---

## Chunk 3: Activity Detail Backend

### Task 6: Define Activity Detail Model

**Files:**
- Modify: `server/domain/models.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Add detail model**

Include:

- `activityId`
- `activityName`
- `hasSignCard`
- `signLists`
- `memberLists`
- `creditItems`
- `creditListsByScoreId`

- [ ] **Step 2: Add person row normalization model**

Use common fields:

- `studentId`
- `studentName`
- `signUpId`
- `userId`
- `signStatus`
- `admitStatus`

### Task 7: Implement Activity Detail Aggregation

**Files:**
- Create: `server/domain/activityDetail.ts`
- Test: `tests/server/activityDetail.test.ts`

- [ ] **Step 1: Write aggregation tests**

Use a fake DM client. Cover sign lists, exported member lists, credit items, credited rows, and unsupported credit type filtering.

- [ ] **Step 2: Implement detail aggregation**

Call:

- `getManagedActivities`
- `getSignCard`
- `getSignList`
- `getCreditTypes`
- `getCreditList`
- `exportMembers`

- [ ] **Step 3: Normalize row identity**

Prefer `signUpId`; fall back to student id and name only for display matching. Do not execute writes without `signUpId`.

- [ ] **Step 4: Run tests**

Run:

```powershell
bun run test tests/server/activityDetail.test.ts
```

Expected: detail aggregation tests pass.

### Task 8: Add Activity Detail Routes

**Files:**
- Modify: `server/routes/activityRoutes.ts`
- Test: `tests/server/routes.test.ts`

- [ ] **Step 1: Add route tests**

Cover:

- `GET /api/activities/:activityId`
- `POST /api/activities/refresh`
- `POST /api/activities/:activityId/refresh`

- [ ] **Step 2: Implement detail route**

Ensure local API is running and session is valid before aggregation.

- [ ] **Step 3: Implement refresh routes**

Refresh routes call the same aggregation path and return fresh data. They must not write online business data.

- [ ] **Step 4: Run route tests**

Run:

```powershell
bun run test tests/server/routes.test.ts tests/server/activityDetail.test.ts
```

Expected: route and aggregation tests pass.

---

## Chunk 4: Operation Plan Backend

### Task 9: Define Operation Plan Models

**Files:**
- Modify: `server/domain/models.ts`
- Modify: `src/types.ts`
- Modify: `server/storage/jsonStore.ts`
- Test: `tests/server/operationPlans.test.ts`

- [ ] **Step 1: Add operation plan types**

Add `OperationPlan`, `OperationAction`, `OperationCreditItem`, `OperationPrecheckReport`, and `OperationPlanSummary`.

- [ ] **Step 2: Extend JSON store collection names**

Add `operation-plans` as a supported collection.

- [ ] **Step 3: Add storage tests**

Cover create, read, list, patch, and audit append for operation plans.

- [ ] **Step 4: Run tests**

Run:

```powershell
bun run test tests/server/jsonStore.test.ts tests/server/operationPlans.test.ts
```

Expected: store supports operation plans.

### Task 10: Implement Operation Plan Creation

**Files:**
- Create: `server/domain/operationPlans.ts`
- Test: `tests/server/operationPlans.test.ts`

- [ ] **Step 1: Write creation tests**

Cover:

- selected unsigned people create `resign` plan.
- selected people and credit item create `issueCredit` plan.
- unsigned people with credit item create `resignThenIssueCredit` plan.
- creation does not call `resign` or `sendCredit`.
- invalid missing `signUpId` is rejected.

- [ ] **Step 2: Implement creation service**

Input should include activity id, operation kind, selected members, selected credit items, and name.

- [ ] **Step 3: Build summary**

Calculate action count, enabled count, target member count, target credit item count, expected resign count, and expected issue count.

- [ ] **Step 4: Run tests**

Run:

```powershell
bun run test tests/server/operationPlans.test.ts
```

Expected: operation plan creation tests pass.

### Task 11: Add Operation Plan Routes

**Files:**
- Create: `server/routes/operationPlanRoutes.ts`
- Modify: `server/routes/router.ts`
- Test: `tests/server/routes.test.ts`

- [ ] **Step 1: Add route tests**

Cover:

- `POST /api/operation-plans`
- `GET /api/operation-plans`
- `GET /api/operation-plans/:id`
- `PATCH /api/operation-plans/:id`

- [ ] **Step 2: Implement create route**

Call the operation plan creation service and persist the plan.

- [ ] **Step 3: Implement list and read routes**

Return newest first if practical; otherwise document current sort order in code comments.

- [ ] **Step 4: Implement patch route**

Allow edits only for `draft` and `ready` statuses.

- [ ] **Step 5: Run route tests**

Run:

```powershell
bun run test tests/server/routes.test.ts tests/server/operationPlans.test.ts
```

Expected: operation plan routes pass.

---

## Chunk 5: Operation Execution Backend

### Task 12: Implement Operation Precheck

**Files:**
- Create: `server/domain/operationExecutor.ts`
- Test: `tests/server/operationExecutor.test.ts`

- [ ] **Step 1: Write precheck tests**

Cover:

- no sign card is blocking.
- missing `signUpId` is blocking.
- already credited is warning or skip.
- capacity shortage is blocking for issue actions.
- unsigned member is required for resign action.
- missing `userId` is remapped when available.

- [ ] **Step 2: Implement precheck**

Read current sign lists, credit lists, and credit items. Return `executable`, `issues`, and normalized actions.

- [ ] **Step 3: Persist precheck result**

Patch operation plan with precheck report and status `ready` when executable.

- [ ] **Step 4: Run tests**

Run:

```powershell
bun run test tests/server/operationExecutor.test.ts
```

Expected: precheck behavior is stable.

### Task 13: Implement Operation Execution

**Files:**
- Modify: `server/domain/operationExecutor.ts`
- Modify: `server/domain/taskRunner.ts`
- Modify: `server/domain/models.ts`
- Test: `tests/server/operationExecutor.test.ts`

- [ ] **Step 1: Write execution tests**

Cover:

- `resign` calls `resign(activityId, [signUpId], false)`.
- `issueCredit` skips already credited members.
- `resignThenIssueCredit` resigns first, then issues credit.
- failed resign prevents issue for that action.
- final verification failure is recorded.
- executed plan becomes `completed` or `failed`.

- [ ] **Step 2: Extend task model**

Add optional `targetType` and `targetId`, while keeping existing plan task compatibility.

- [ ] **Step 3: Implement execution**

Use current data reads immediately before writes. Do not reuse stale detail data as proof.

- [ ] **Step 4: Record task events**

Record concise events without sensitive data.

- [ ] **Step 5: Run tests**

Run:

```powershell
bun run test tests/server/operationExecutor.test.ts tests/server/routes.test.ts
```

Expected: operation execution tests pass.

### Task 14: Add Operation Precheck And Execute Routes

**Files:**
- Modify: `server/routes/operationPlanRoutes.ts`
- Modify: `server/routes/taskRoutes.ts` if shared task lookup needs target fields
- Test: `tests/server/routes.test.ts`

- [ ] **Step 1: Add route tests**

Cover:

- `POST /api/operation-plans/:id/precheck`
- `POST /api/operation-plans/:id/execute`

- [ ] **Step 2: Implement precheck route**

Ensure local proxy is running and session is authenticated.

- [ ] **Step 3: Implement execute route**

Require body `{ confirmText: "执行操作计划" }`.

- [ ] **Step 4: Run route tests**

Run:

```powershell
bun run test tests/server/routes.test.ts tests/server/operationExecutor.test.ts
```

Expected: operation plan write routes pass.

---

## Chunk 6: Activity Detail UI And Plan Creation

### Task 15: Build Activity Detail Components

**Files:**
- Create: `src/components/ActivityDetail.vue`
- Create: `src/components/ActivityMemberTable.vue`
- Create: `src/components/CreditIssueTable.vue`
- Modify: `src/views/ActivityOverview.vue`
- Modify: `src/types.ts`

- [ ] **Step 1: Add selected activity state**

Clicking an activity row loads `GET /api/activities/:activityId`.

- [ ] **Step 2: Render detail layout**

Use compact full-width sections, not nested cards. Keep tables horizontally scrollable.

- [ ] **Step 3: Add filters**

Support name, student id, signUpId, userId, sign status, admit status, credit type, and issue status.

- [ ] **Step 4: Add stable selection**

Selection key should be `signUpId` for member actions.

- [ ] **Step 5: Run typecheck**

Run:

```powershell
bun run typecheck
```

Expected: no frontend type errors.

### Task 16: Build Operation Plan Creator UI

**Files:**
- Create: `src/components/OperationPlanCreator.vue`
- Modify: `src/components/ActivityDetail.vue`
- Modify: `src/views/ActivityOverview.vue`

- [ ] **Step 1: Add create plan buttons**

Buttons:

- 生成补签计划
- 生成发放计划
- 生成补签后发放计划

- [ ] **Step 2: Add credit item selection**

Issue actions require selecting one or more credit items from the activity.

- [ ] **Step 3: Call create route**

Call `POST /api/operation-plans`. On success, show created plan id/name and offer to open plan center.

- [ ] **Step 4: Prevent direct writes**

Verify no UI action from activity detail calls `/execute`, `/sign/resign`, or `/credit/send`.

- [ ] **Step 5: Run typecheck**

Run:

```powershell
bun run typecheck
```

Expected: no frontend type errors.

---

## Chunk 7: Plan Center And Execution Center UI

### Task 17: Show Operation Plans In Plan Center

**Files:**
- Modify: `src/views/PlanCenter.vue`
- Create: `src/components/OperationPlanTable.vue`
- Modify: `src/types.ts`

- [ ] **Step 1: Load operation plans**

Call `GET /api/operation-plans` alongside existing `GET /api/plans`.

- [ ] **Step 2: Add plan type tabs**

Tabs:

- Excel 学分计划
- 活动操作计划

- [ ] **Step 3: Render operation plan summary**

Show status, operation kind, activity, action count, expected resign count, expected issue count.

- [ ] **Step 4: Allow draft edits**

Allow disabling individual actions for `draft` and `ready` plans.

- [ ] **Step 5: Run typecheck**

Run:

```powershell
bun run typecheck
```

Expected: no frontend type errors.

### Task 18: Support Operation Plans In Execution Center

**Files:**
- Modify: `src/views/ExecutionCenter.vue`
- Modify: `src/components/ExecutionPrecheck.vue`
- Modify: `src/components/ExecutionResults.vue`
- Modify: `src/components/ExecutionProgress.vue`

- [ ] **Step 1: Load both plan types**

Show executable Excel plans and operation plans in one selector with clear labels.

- [ ] **Step 2: Route precheck by plan type**

Use:

- `POST /api/plans/:id/precheck`
- `POST /api/operation-plans/:id/precheck`

- [ ] **Step 3: Route execute by plan type**

Use:

- `POST /api/plans/:id/execute`
- `POST /api/operation-plans/:id/execute`

For operation plans send `{ confirmText: "执行操作计划" }`.

- [ ] **Step 4: Update confirmation text**

Display the required confirmation text based on selected plan type.

- [ ] **Step 5: Run typecheck**

Run:

```powershell
bun run typecheck
```

Expected: no frontend type errors.

---

## Chunk 8: Verification

### Task 19: Backend Test Pass

**Files:**
- All backend files touched above

- [ ] **Step 1: Run targeted tests**

Run:

```powershell
bun run test tests/server/session.test.ts tests/server/activityDetail.test.ts tests/server/operationPlans.test.ts tests/server/operationExecutor.test.ts tests/server/routes.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run full tests**

Run:

```powershell
bun run test
```

Expected: all tests pass.

### Task 20: Typecheck And Build

**Files:**
- All frontend and backend files touched above

- [ ] **Step 1: Run typecheck**

Run:

```powershell
bun run typecheck
```

Expected: no type errors.

- [ ] **Step 2: Run build**

Run:

```powershell
bun run build
```

Expected: Vite build succeeds.

### Task 21: Local UI Verification

**Files:**
- Frontend files touched above

- [ ] **Step 1: Start backend**

Run:

```powershell
bun run dev
```

Expected: backend starts on configured port.

- [ ] **Step 2: Start UI**

Run in another shell:

```powershell
bun run dev:ui
```

Expected: Vite serves the UI.

- [ ] **Step 3: Verify flows in browser**

Check:

- unauthenticated login screen.
- account login.
- export URL login validation.
- session status and logout.
- activity detail rendering.
- operation plan creation.
- plan center operation tab.
- execution center precheck and confirmation state.

- [ ] **Step 4: Fix visual issues**

Ensure text does not overlap, table controls remain usable, and buttons keep stable dimensions on desktop and mobile.

### Task 22: Final Summary

**Files:**
- All changed files

- [ ] **Step 1: Check git status**

Run:

```powershell
git status --short
```

Expected: only intentional files changed.

- [ ] **Step 2: Summarize verification**

Report:

- changed areas.
- tests run.
- build status.
- unsupported capabilities, if any.

Do not commit unless the user explicitly asks.
