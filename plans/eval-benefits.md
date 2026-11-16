# Plan: Evaluate whether pi-fleet is beneficial (keep investing / dogfood)

## Goal
Decide, with defensible evidence, whether pi-fleet earns its keep: is the
cache-stable planner/executor split + memory layer a net win over vanilla pi on
representative real work, or a "nice addition" not worth the overhead? The
decision it drives is twofold: **keep investing** and **publish/dogfood as a
real tool** — so the evaluation must be repeatable across tasks and at least
two projects, not a single anecdote.

## Scope
- In scope: instrument `runSubagent` to surface per-child usage; run a small
  matrix of representative tasks both ways (vanilla pi vs. pi-fleet) across two
  projects; measure parent-context growth, total token cost (parent + child),
  cache-hit behaviour across repeated `/plan` calls, plan-quality/rework count,
  and memory recall precision; write a verdict per dimension to
  `docs/research.md`.
- Out of scope: benchmarking other agents (opencode/omp); automated quality
  scoring (human judgment per task); publishing anything; changing the
  extension's behaviour beyond the usage-instrumentation seam.

## Context from the Option A spike (2026-08-10)

A quick illustrative before/after was run before this plan. Findings that shape
the eval design:

- **Trivial task (create a 2-function math.ts):** both correct; pi-fleet was
  ~2.4× slower and the *parent* context was actually *larger* (subagent's
  narrative answer is bulkier than raw tool results). Pure overhead — nothing
  to discard.
- **Explore-then-act task (read 3 source files → write a summary):** both
  correct; pi-fleet's **parent final-input was 2030 vs 4777** (~2.7k smaller)
  because the 3 file reads happened in the child and were discarded.
  Parent-context cleanliness is real **but only materializes when the subagent
  does substantial exploration that gets thrown away.**
- **Total token cost could NOT be measured** — the child's usage is hidden
  inside `createAgentSession` and never emitted to the parent's JSON stream.
  Instrumenting this is a prerequisite for the eval (Milestone 1).
- **The actual differentiator (cache stability + plan quality + memory) was not
  exercised** — needs repeated `/plan` calls, multi-step tasks, and a second
  project. That is what this plan adds.

So the eval must NOT use only trivial tasks (they make pi-fleet look pointless),
and it must NOT rely on the parent stream alone for cost (child usage is
invisible without instrumentation).

## Approach

### Milestone 1: Instrument `runSubagent` to return child usage (prerequisite)
1. In `src/subagent.ts`, add an exported **pure** helper `sumUsage(messages:
   AgentMessage[]): Usage` that sums `usage` across assistant messages
   (`input`, `output`, `cacheRead`, `cacheWrite`, `cost.total`). The data is
   already there — `AssistantMessage.usage: Usage` (from `@earendil-works/pi-ai`)
   carries all those fields. Call it after `session.prompt()` resolves and add a
   `usage` aggregate to `SubagentResult`. **Make `usage` optional**
   (`usage?: Usage`) — the existing `coordinator.test.ts` stub returns
   `SubagentResult` literals without it, and error/abort paths may have no
   assistant turn to sum; a required field would break `npm run check` and force
   fabrication. The helper is pure because
   `runSubagent` calls `createAgentSession()` directly with **no injectable
   session seam** — the only injection point (`_runSubagent`) lives one level
   up in `coordinator.ts`, so inlining the summation would make it untestable
   without a real provider.
2. In `src/coordinator.ts`, thread child usage through `CoordinatorResult` so
   the `plan` pipeline can report per-child usage: add `plannerUsage` to every
   status and `executorUsage` to the `executed` status. In `src/index.ts`, then
   include child usage in the `task` and `plan` tool `details` and in
   `/plan`/`/reviewer` notify text (so a human can see it). This is read-only
   instrumentation — no behaviour change. (`coordinator.ts` must change because
   the `plan` tool calls `runPlanExecute`, not `runSubagent` directly.)
3. Add `test/subagent-usage.test.ts` that builds a hand-constructed
   `AgentMessage[]` (two assistant turns with known `usage`, plus a user and a
   toolResult message that must be skipped) and asserts `sumUsage` returns the
   correct summed `Usage`. No provider, no session — the test targets the pure
   helper, not `runSubagent`'s integration path.
→ Verify: `npm test` green; `npm run check` clean; a live `task` tool call
reports non-zero child input tokens in `details.usage`.

### Milestone 2: Define the task matrix + baselines
1. Pick **two projects**: pi-fleet itself (TS, already loaded) and one other
   real project in `~/Projects` with a different shape (more files / a bug to
   fix). Record the chosen project + why in `docs/research.md`.
2. Define **4 representative tasks** (same wording, run both ways):
   - T1 — trivial (the math.ts task from Option A): establishes the overhead
     floor. Expected: pi-fleet loses.
   - T2 — explore-then-act (read ≥3 files, then edit one): the
     discarded-working-context case. Expected: parent context smaller; total
     cost TBD.
   - T3 — multi-step fix with a "premature-edit trap" (a bug that must be read
     before editing, where editing blind causes rework): the plan-quality case.
     Expected: `/plan` produces one focused executor pass; inline may take
     extra follow-up turns.
   - T4 — recall-dependent (a task where a remembered decision should change
     the outcome): the memory case. Expected: recall surfaces the fact in a
     fresh session; vanilla has no persistence.
3. Fix the run protocol: same model for both; `--no-extensions --no-skills
   --no-context-files` (smoke-check these flags exist in the installed pi CLI
   before the first run — if any is unsupported, fall back to the closest
   equivalent and record it); fresh sandbox/git-clean checkout per run; capture
   the JSON stream to a file; reset project state between runs.
4. **Pin the provider for the cache dimension.** T3 (and ideally every task)
   MUST run on a provider that actually reports `cacheRead`/`cacheWrite` —
   DeepSeek, GLM, Kimi, or Anthropic via their real APIs. **Do not run the
   cache-dimension runs on local ollama**: ollama typically reports
   `cacheRead=0`, which would silently nullify the project's core
   differentiator claim and make the verdict unknowable rather than
   informative. Local ollama is fine only for a separate, clearly-labelled
   "no-cache" row if you want one; it cannot be the primary row. Record the
   chosen provider + model id in `docs/research.md`.
→ Verify: the 4 tasks are written into `docs/research.md` with their exact
wording and the chosen second project.

### Milestone 3: Run the matrix + capture metrics
For each task, run **baseline** (vanilla pi inline) and **pi-fleet** (via the
`plan`/`task`/`remember`+`recall` tools as appropriate), capturing per run:
- **parent final input** (parent context size at task end) — from the parent
  stream's last assistant `usage.input`.
- **total tokens (parent + child)** — parent stream sum + the new child-usage
  aggregate from Milestone 1. This is the honest cost number.
- **cacheRead / cacheWrite** — summed across all turns incl. children.
- **wall time** — outer timestamp delta.
- **cost** — summed `usage.cost.total` (0 on local ollama; recorded for shape).
- **rework count** — human-judged: number of follow-up correction turns needed
  after the first "done" (0 = first-try success).
- **quality verdict** — one line: did the change satisfy the task exactly?
Run T3 with `/plan` (interactive TUI for the approval gate) and **3× in one
session** to capture the cache-stability dimension: does `cacheRead` climb
across repeated planner/executor calls with the stable `sessionId`s?
Answer the approval gate **identically** on all 3 runs (same task wording,
same approval choice) so the executor's prompt prefix stays byte-stable across
the repeats — an inconsistent approval would change the executor's prefix and
reset its cache, contaminating the series.
→ Verify: a results table per task in `docs/research.md` with both columns
filled, including the 3× cache-read series for T3.

### Milestone 4: Verdict per dimension + overall recommendation
1. Write a verdict for each of the 5 dimensions (parent cleanliness, total
   cost, cache efficiency, plan quality / rework, memory) — each "win / loss /
   conditional" with the evidence row that supports it. No single aggregate
   score; the dimensions trade off and a single number would hide that.
2. State the **boundary**: which task shapes pi-fleet wins on, which it loses
   on (the Option A spike already shows trivial one-shot tasks are a loss).
3. Write the overall recommendation against the two driving decisions:
   - **Keep investing?** — yes/no/conditional, with the cheapest next
     experiment that would flip it if borderline.
   - **Publish/dogfood?** — yes/no/conditional, with what would have to be true
     (e.g., cache wins must materialize on T3; memory must be reliable).
4. Log the decision in `docs/decisions.md`.
→ Verify: `docs/research.md` has the full results table + per-dimension
verdicts; `docs/decisions.md` has the keep-invest / dogfood decision with
rationale and the boundary stated.

## Affected Files
- Modify: `src/subagent.ts` (`sumUsage` helper + `usage` aggregate on
  `SubagentResult`), `src/coordinator.ts` (thread planner/executor usage into
  `CoordinatorResult`), `src/index.ts` (surface child usage in tool/command
  output).
- New: `test/subagent-usage.test.ts`.
- Docs only: `docs/research.md` (task matrix, results, verdicts),
  `docs/decisions.md` (decision).

## Acceptance Criteria
- [ ] `runSubagent` returns summed child usage (input/output/cacheRead/
      cacheWrite/cost); a unit test covers it; `npm test` + `npm run check` pass.
- [ ] All 4 tasks run both ways across both projects; results table complete
      with parent input, total (parent+child) tokens, cacheRead, wall time,
      rework count, and quality verdict for each cell.
- [ ] T3's 3× repeated-run cache series shows whether `cacheRead` climbs with
      the stable `sessionId`s (the core differentiator claim is confirmed or
      refuted by real numbers).
- [ ] A per-dimension verdict + an explicit win/loss boundary (task shapes)
      is recorded in `docs/research.md`.
- [ ] A keep-invest decision AND a dogfood decision are recorded in
      `docs/decisions.md`, each with rationale.

## Tests
- Test type: Unit (usage aggregation with a stubbed session) + manual eval
  matrix (the 4 tasks × 2 projects × 2 modes).
- New: `test/subagent-usage.test.ts`.

## Decisions Log
| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|------------------------|-----|
| Measure total cost, not just parent cost | Instrument `runSubagent` to surface child usage | Read only the parent stream (Option A style) | Option A proved the parent stream hides the child's tokens; "total cost" without the child is a lie and would bias the verdict toward pi-fleet |
| One trivial task stays in the matrix | T1 (math.ts) kept | Drop trivial tasks | It anchors the overhead floor and defines the loss boundary — removing it would make the eval look flattering |
| Human-judged quality, not auto-scoring | One-line verdict per task | Automated pass/fail or an LLM judge | Auto-scoring adds machinery for 4 tasks; human judgment is cheaper, defensible at this scale, and matches "publish/dogfood" rigor for a first eval |
| Verdict per dimension, not a single score | 5 separate win/loss/conditional verdicts | Aggregate score | The dimensions trade off (cost↑, context↓, quality?, cache?). One number hides the exact trade the user is deciding on |
| Two projects, not one | pi-fleet + one other real project | pi-fleet only | The driving decision is "publish/dogfood" — one project can't rule out a lucky fit. A second, different-shaped project raises confidence cheaply |

## Review Log

### Review 1 — 2026-08-10
**Flaws found:** 0 blocking (plan authored after the Option A spike, so the
instrumentation and trivial-task pitfalls were known up front).
**Still open:**
- The second project choice (Milestone 2) is left to execution — it should be a
  project with a real fixable bug (for T3) and enough files for exploration (for
  T2). Picking one that is too small would make T2/T3 uninformative.

### Review 2 — 2026-08-10
**Flaws found:** 4 (1 critical, 3 moderate)
**Changes made:**
- **Test design (Milestone 1)** — extracted the usage summation into a named
  pure helper `sumUsage(messages)` and rewrote the unit test to target it with a
  hand-built `AgentMessage[]`. **Reason:** `runSubagent` calls
  `createAgentSession()` directly with no injectable session seam (verified in
  `src/subagent.ts`); the only stub point is `_runSubagent` in `coordinator.ts`,
  one level up. Inlining the summation would make the test require a real
  provider — contradicting the plan's own "does not require a real provider"
  claim.
- **Affected Files + Milestone 1 step 2** — added `src/coordinator.ts` to
  Affected Files and added a step to thread planner/executor usage into
  `CoordinatorResult`. **Reason:** the `plan` tool calls `runPlanExecute`, not
  `runSubagent`; without surfacing usage through `CoordinatorResult`, the `plan`
  tool's `details.usage` would be silently empty, defeating Milestone 1's goal
  for half the pipeline.
- **Provider pin for the cache dimension (Milestone 2 step 4)** — made it a
  hard requirement that T3 run on a cache-reporting provider (DeepSeek/GLM/Kimi/
  Anthropic) and explicitly forbade local ollama as the primary row.
  **Reason:** the plan defaults to local ollama (`cost=0`), but ollama reports
  `cacheRead=0`. The cache-stability dimension is the project's **core
  differentiator** — running it on a non-reporting provider would produce a
  meaningless zero and an unknowable verdict on the single most important
  claim. Also added an approval-consistency note on the T3 3× repeats
  (inconsistent approvals mutate the executor prefix and reset its cache).
- **`SubagentResult.usage` must be optional (recheck)** — made `usage?: Usage`
  explicit in Milestone 1 step 1. **Reason:** a required field would break the
  existing `coordinator.test.ts` stub (returns `SubagentResult` literals with no
  `usage` → `tsc` error) and force error/abort paths to fabricate usage. Optional
  keeps `npm run check` green and is honest about paths that have no assistant
  turn to sum.
**Still open:**
- The `--no-extensions --no-skills --no-context-files` flags are asserted but
  not verified against the installed pi CLI. **Reason not resolved:** they are
  pi CLI flags, not in this repo, so they can't be checked here; flagged as a
  pre-run smoke check in Milestone 2 step 3.
- The second-project choice (carried from Review 1) remains an execution-time
  decision.