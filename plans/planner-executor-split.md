# Plan: Cache-stable planner/executor split

## Goal
Add pi-fleet's core differentiator: run a read-only **planner** and a
tool-using **executor** as two *separate, cache-stable sessions* (distinct,
stable `sessionId`s), chained through a coordinator. This is the one capability
none of pi / OpenCode / oh-my-pi covers portably. Builds directly on the
verified `runSubagent` runtime.

## Scope
- In scope: a `coordinator` that chains planner → (approval gate) → executor;
  planner/executor profiles; structured planner markers; a stable-`sessionId`
  option on `runSubagent`; a `/plan` command + `plan` tool; unit tests for
  marker parsing and coordinator control flow.
- Out of scope: replacing pi's main turn loop; multi-model config UI; parallel
  `fleet` execution; telemetry (separate plan); the compaction ladder.

## Approach

### Milestone 1: Stable sessionId on the subagent runtime
1. In `src/subagent.ts`, extend `RunSubagentArgs` with `sessionId?: string`.
2. In `runSubagent`, pass it through: `SessionManager.inMemory(args.cwd, args.sessionId ? { id: args.sessionId } : undefined)` — this pins the child's provider session-affinity key (verified: `inMemory(cwd, { id })` sets `session.sessionId` → `Agent.sessionId` → `x-session-affinity`).
3. Return `sessionId` on `SubagentResult` for logging.
→ Verify: `grep` shows `inMemory` receives the id; a temporary log in `/reviewer` prints a stable id across two invocations.

### Milestone 2: Planner + executor profiles
1. In `src/profiles.ts`, add a `planner` profile (`tools: "read-only"`) whose `systemPrompt` is adapted from Reasonix's `DefaultPlannerPrompt`: produce an ordered, executor-ready plan; research with read-only tools only; never write/execute; end with exactly `[no_changes]` when nothing is needed, or `[planner_requires_approval]` when execution must pause, or a `<planner-ask>…</planner-ask>` block for a user-owned decision.
2. Add an `executor` profile (`tools: "coding"`) whose `systemPrompt` says: you are the executor; carry out the provided plan with your tools; keep changes focused.
3. Export both via `profileNames()`.
→ Verify: `loadProfile("planner")` and `loadProfile("executor")` resolve; planner posture is read-only.

### Milestone 3: Marker parsing (pure, test-first)
1. Create `src/markers.ts` with `parsePlan(text): { plan: string; verdict: "proceed" | "no_changes" | "requires_approval"; ask?: { question: string; options: string[] } }`.
2. Write `test/markers.test.ts` first (red): assert `[no_changes]` → `no_changes`; `[planner_requires_approval]` → `requires_approval`; a `<planner-ask>` block → parsed `ask` with question + options; plain text → `proceed`.
3. Implement `parsePlan` to pass (green). Constants for the three markers live here.
→ Verify: `bun test test/markers.test.ts` (or `node --test`) passes.

### Milestone 4: Coordinator
1. Create `src/coordinator.ts` exporting `runPlanExecute(args: { task, cwd, plannerModel?, executorModel?, approve?, signal? }): Promise<CoordinatorResult>`. `approve?: (plan: string) => Promise<boolean>` is the single interactive seam (used for the `[planner_requires_approval]` gate); `needs_input` is always returned to the caller, since a `<planner-ask>` block is a user-owned decision the coordinator cannot auto-answer.
2. Step 1 — planner: `runSubagent({ profile: planner, prompt: task, cwd, model: plannerModel, sessionId: "pi-fleet.planner" })`. (Session ids must match `assertValidSessionId`'s charset `[A-Za-z0-9._-]` — colons are rejected, so use a dot, not a colon.)
3. Step 2 — `parsePlan(plannerAnswer)`:
   - `no_changes` → return `{ status: "no_changes", plan }` without executing.
   - `requires_approval` → if `approve` is provided, `await approve(plan)`; on true continue to Step 3, on false return `{ status: "needs_approval", plan }`. If `approve` is absent (headless / LLM-callable tool), return `{ status: "needs_approval", plan }` (fail-closed).
   - `ask` → return `{ status: "needs_input", plan, ask }` (caller surfaces the question).
   - `proceed` → continue.
4. Step 3 — executor: `runSubagent({ profile: executor, prompt: plan, cwd, model: executorModel, sessionId: "pi-fleet.executor" })`; return `{ status: "executed", plan, result }`.
→ Verify: unit test `test/coordinator.test.ts` with a stubbed `runSubagent` covers all four branches (no_changes / needs_approval / needs_input / executed).

### Milestone 5: Extension surface
1. In `src/index.ts`, register a `plan` tool (LLM-callable): params `{ task: string }`; `execute` calls `runPlanExecute` with `ctx.model` for both roles and returns the plan + executor result (or the gate status) as `content`.
2. Register a `/plan` command (human-callable): runs `runPlanExecute` with `approve: (plan) => ctx.ui.confirm("Execute plan?", plan)` so the coordinator gates the executor step inline (no re-run); on `needs_input` surface the ask via `ctx.ui.select`/`ctx.ui.input`; on success `ctx.ui.notify` the result.
3. Distinct planner/executor `sessionId`s already set in the coordinator keep each prefix cache-stable across a session's repeated `/plan` calls.
→ Verify: `pi -e ./src/index.ts` (once pi packages installed) exposes `plan` + `/plan`; a trivial task produces a plan then an execution.

## Affected Files
- Modify: `src/subagent.ts` (sessionId passthrough), `src/profiles.ts` (planner + executor), `src/index.ts` (plan tool + /plan command).
- New: `src/markers.ts`, `src/coordinator.ts`, `test/markers.test.ts`, `test/coordinator.test.ts`.

## Acceptance Criteria
- [ ] Planner and executor run as separate sessions with distinct, stable `sessionId`s (planner read-only tools, executor coding tools).
- [ ] `[no_changes]` skips execution; `[planner_requires_approval]` gates execution; `<planner-ask>` surfaces a question — all covered by tests.
- [ ] `plan` tool and `/plan` command work end-to-end against a real provider.
- [ ] No change to `runSubagent`'s existing `/reviewer` behavior (regression).

## Tests
- Test type: Unit (marker parsing, coordinator branches with stubbed runSubagent) + one manual E2E via `pi -e`.
- Existing to run: current `/reviewer` path still works.
- New: `test/markers.test.ts`, `test/coordinator.test.ts`.

## Decisions Log
| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|------------------------|-----|
| Integration surface | `/plan` command + `plan` tool | Intercept main turn via `before_agent_start`; replace turn loop | Non-invasive, matches pi's extension model; no fork of the main loop |
| Planner/executor isolation | Two separate `runSubagent` sessions with distinct stable `sessionId`s | One session that swaps tools mid-run | Separate sessions keep each prefix byte-stable → provider cache stays warm (the whole point) |
| Approval when headless | Return `needs_approval` without executing | Auto-proceed | Fail-closed: never run side-effecting executor without a decision |
| Marker set | Reuse Reasonix's `[no_changes]` / `[planner_requires_approval]` / `<planner-ask>` | Invent new markers | Proven design; keeps planner prompt portable |

## Review Log

### Review 1 — 2026-08-07
**Flaws found:** 1 critical, 1 improvement
**Changes made:**
- **Session id charset (Critical):** Changed planner/executor `sessionId`s from `pi-fleet:planner` / `pi-fleet:executor` to `pi-fleet.planner` / `pi-fleet.executor`. — **Reason:** Verified against pi source (`packages/coding-agent/src/core/session-manager.ts:212` `assertValidSessionId`): the regex `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$` rejects colons. The original ids would have thrown `"Session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.'"` at `SessionManager.inMemory(cwd, { id })` construction — i.e. every `/plan` call would crash before reaching the planner. Added a one-line note in Milestone 4 so future edits don't reintroduce the colon.
- **Coordinator interactive seam (Improvement):** Replaced the dual `ui?` / `ask?` hooks on `runPlanExecute` with a single `approve?: (plan: string) => Promise<boolean>` callback, and made `needs_input` always return to the caller. — **Reason:** The original signature listed `ui?` and `ask?` separately but the Step-2 prose conflated them ("if a UI/ask hook is provided, gate on it"), leaving two undefined ways to do interactive gating. A `<planner-ask>` block is a user-owned decision the coordinator cannot auto-answer, so it should never be swallowed by a hook — return it to the caller. The `/plan` command now passes `approve: (plan) => ctx.ui.confirm(...)` so the coordinator gates the executor inline (no "re-running the executor step" ambiguity).
**Still open:**
- None blocking. Minor follow-up for implementation: the `test/coordinator.test.ts` verify should also cover the `approve`-provided-true sub-case (it collapses into the `executed` branch) and the `approve`-absent headless sub-case (`needs_approval`), in addition to the four status branches listed.

### Recheck (Pass 2) — 2026-08-07
**Flaws found:** 0 new
**Changes made:** none — plan is stable after Review 1.
**Rechecks:**
- `assertValidSessionId` is the only id-validation gate on this path; `pi-fleet.planner` / `pi-fleet.executor` both pass the regex (confirmed programmatically). No further id-format issue.
- `createAgentSession` accepts `model: undefined` (falls back to `findInitialModel` via settings), so the coordinator passing `plannerModel`/`executorModel` that may be undefined is safe — verified in `packages/coding-agent/src/core/sdk.ts:169-289`.
- `ctx.ui.confirm` / `ctx.ui.select` / `ctx.ui.input` / `ctx.ui.notify` all exist on `ExtensionUIContext` (`packages/coding-agent/src/core/extensions/types.ts:131-142`), so the Milestone-5 UI calls are valid.
- The `approve`-callback consolidation did not introduce a new way to bypass the executor (fail-closed path preserved when `approve` is absent).
