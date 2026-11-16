# pi-fleet — research & context log

Onboarding doc for a fresh session. Read this after `AGENTS.md` to understand
**why** this project exists and **what has been decided**, without re-deriving it.
Durable decisions live in `docs/decisions.md`; step-by-step plans in `plans/`.

---

## 2026-08-07 — Origin: how pi-fleet came to be

The project started from one question: *DeepSeek-Reasonix claims to be optimized
for DeepSeek — what of that could extend pi?* Investigating four coding-agent
repos led to a specific, narrow thesis. This log records that investigation so it
isn't lost.

### The four repos (all under `~/Projects/open-sources/`)

| Repo | What it is | Relevance |
| --- | --- | --- |
| `pi` | Upstream pi (badlogic/pi-mono), MIT. Lean TS, extension-first, embeddable `Agent` SDK. Our **build target**. | Host for pi-fleet |
| `DeepSeek-Reasonix` | Go, DeepSeek-native agent, MIT. Source of the **ideas** we port. | Idea source |
| `opencode` | OpenCode (anomalyco), heavy Effect/product platform. Ships subagents natively. | Competitive reference |
| `oh-my-pi` | `omp`, MIT **fork of pi** (can1357). Batteries-included: subagents, `snapcompact`, `mnemopi`, Rust core. | Idea mine (not a dep) |

### What "DeepSeek-optimized" actually means in Reasonix

Not a model integration — three concrete mechanisms (all portable, model-agnostic
in principle):
1. **Prefix-cache stability** — the system-prompt prefix (base prompt + tools +
   memory) is kept byte-stable across turns so DeepSeek's *automatic* prefix cache
   stays warm; volatile context "rides the turn tail." (`REASONIX.md`,
   `internal/agent/compact.go`.)
2. **Graduated compaction ladder** — soft(0.5, notice only) → snip(0.6, elide
   stale tool results cheaply, often avoids a paid summarize) → compact(0.8,
   summarize) → force(0.9). Plus `foldEconomics`, fixed tail-token budget, and a
   re-compaction-loop guard. pi's compaction is a single binary threshold by
   contrast.
3. **Two-model planner/executor in *separate* sessions** — so neither model's
   prefix is disturbed by the other's turns (`internal/agent/coordinator.go`).
   Planner is read-only; markers `[no_changes]` / `[planner_requires_approval]` /
   `<planner-ask>`.
   Also notable: a **3-line base system prompt**, and static-English policy
   appends done deliberately to keep the prefix cache-stable.

### The competitive recalibration (the key insight)

Both OpenCode **and** oh-my-pi already ship subagents + compaction (omp also ships
`snapcompact` and `mnemopi` memory). Only upstream **pi** ships none. Therefore:

- "Subagents for pi" is worth building (pi lacks them) but is **table-stakes, not a
  differentiator**.
- pi-fleet's **core** is the one corner nobody covers portably: Reasonix's
  **cache-stable planner/executor split** + a **model-agnostic per-provider cache
  strategy**. Subagents/compaction/guardian are substrate and supporting features.

See `docs/decisions.md` (2026-08-07 entries) for the recorded decisions.

---

## Verified pi facts (don't re-derive these)

Checked directly against `~/Projects/open-sources/pi` source:

- **Extension model**: `export default function (pi: ExtensionAPI) {}`, dropped in
  `~/.pi/agent/extensions/` or `.pi/extensions/`, hot-reload `/reload`. Seams:
  `pi.registerTool` (uses `execute()` returning `{ content, details }`, needs
  `label`), `pi.registerCommand` (uses `handler`), `pi.registerProvider`, and
  events incl. `session_before_compact` (customizable) and
  `after_provider_response` (usage/telemetry).
- **Embeddable runtime**: prefer the SDK's `createAgentSession()` over a raw
  `Agent` — it wires model/tools/auth/compaction. `session.prompt(text)` then read
  `session.messages`. `SessionManager.inMemory(cwd, { id })` = ephemeral child with
  a **settable sessionId** (→ provider `x-session-affinity` header = the cache-node
  key). Custom child prompt via `DefaultResourceLoader({ systemPromptOverride })`
  (needs `cwd` + `getAgentDir()` + `SettingsManager`).
- **Context**: `ctx.cwd`, `ctx.model` (full `Model`), `ctx.modelRegistry`,
  `ctx.signal`, `ctx.ui`.
- **Tools by name**: `createAgentSession({ tools: ["read","grep",...] })`. Built-ins:
  `read, grep, find, ls, edit, write, bash`.
- **Providers**: pi already registers DeepSeek, GLM (`zai.glm-4.7`), Kimi
  (`moonshot.kimi-k2-thinking`, `moonshotai.kimi-k2.5`).
- **Imports**: `@earendil-works/pi-coding-agent` (createAgentSession,
  DefaultResourceLoader, SessionManager, SettingsManager, getAgentDir,
  ExtensionAPI), `@earendil-works/pi-agent-core` (Agent, AgentMessage), and `Model`
  from `@earendil-works/pi-ai`.

## Model-agnostic principle

Features are indifferent to the model; only prefix/context-cache mechanics differ.
All provider-specific logic is isolated in `src/providers.ts` (`cacheStrategyFor`):
DeepSeek (automatic prefix cache), GLM (automatic + preserve `reasoning_content`),
Kimi (context cache), Anthropic/OpenAI (explicit `cache_control`), unknown
(best-effort). An unrecognised provider degrades, never errors.

## oh-my-pi rules (MIT fork — idea mine, not a dependency)

Never `npm install @oh-my-pi/*` — its packages hard-couple to omp's forked
`@oh-my-pi/pi-ai`, native `pi-natives`, and Bun APIs (`bun:sqlite`). Steal **ideas**
freely; **vendor** MIT leaf code into `src/vendor/` with headers + pinned commit,
rewiring deps to upstream. See `THIRD_PARTY.md`.

---

## Current state (Phase 1 + Phase 2 + mnemopi port done)

Built and verified against pi source; `npm run check` (`tsc --noEmit`) is clean
and `npm test` passes 36 unit tests.

- `src/subagent.ts` — `runSubagent()`: isolated ephemeral child via
  `createAgentSession` + `SessionManager.inMemory`, returns final answer only.
  Now accepts an optional `sessionId` to pin provider session affinity.
- `src/index.ts` — `task` tool + `/reviewer` command (Phase 1); `plan` tool +
  `/plan` command (Phase 2); `remember`/`recall` tools + `/recall` command
  (mnemopi port).
- `src/profiles.ts` — `reviewer` (read-only), `planner` (read-only), `executor`
  (coding) profiles.
- `src/markers.ts` — pure parser for `[no_changes]` /
  `[planner_requires_approval]` / `<planner-ask>` markers.
- `src/coordinator.ts` — `runPlanExecute()`: planner → (approval gate) →
  executor, each a separate cache-stable session (`pi-fleet.planner` /
  `pi-fleet.executor`). Fail-closed when no approver; `needs_input` surfaced to
  caller.
- `src/providers.ts` — `cacheStrategyFor` (the only provider-aware file).
- `src/memory.ts` — project-scoped wrapper around the vendored mnemopi facade;
  backs the `remember`/`recall` tools. FTS5-only recall in the first port
  (embeddings deferred behind an `Embedder` interface).
- `src/vendor/mnemopi/` — vendored subset of omp's mnemopi (MIT, commit
  `3a8591a8a`), ported from `bun:sqlite`/`@oh-my-pi/*` to
  `better-sqlite3`/`@earendil-works/pi-ai`. ~28 files of 66; embeddings/LLM/
  consolidation/SHMR/triples/MCP/CLI stubbed or dropped. `db.ts` provides a
  bun:sqlite-compatible `Database`/`Statement` wrapper over `better-sqlite3`.
  `adapters.ts` is the re-wiring seam (logger, `hostMatchesUrl`, `ApiKey`,
  `withAuth` stubs).
- `test/markers.test.ts`, `test/coordinator.test.ts` — 14 passing unit tests.
- `test/vendor-mnemopi/store.test.ts`, `test/memory.test.ts` — 4 store/tool
  round-trip tests.
- `test/subagent-usage.test.ts` — 5 tests for the `sumUsage` helper
  (Milestone 1 of the eval-benefits plan).

## What's next

Built plans in `plans/`:
1. **`planner-executor-split.md`** — the core differentiator. **Done.**
2. **`mnemopi-port.md`** — spike-gated port of omp's SQLite memory. **Done**
   (Phase A = GO, Phase B = ported; FTS5-only recall, embeddings deferred).

Later/unbuilt: guardian (tool-approval reviewer subagent), compaction ladder
(inform it with snapcompact's provider-billing-aware, no-LLM insight), cache-hit
telemetry. Optional: wire a real `Embedder` (e.g. `@xenova/transformers`) behind
the `Embedder` interface to restore semantic/vector recall, and load
`sqlite-vec` for `vec0` tables.

## File map

- `AGENTS.md` — project rules + verified API facts.
- `docs/decisions.md` — recorded decisions (the "why").
- `docs/research.md` — this file (the investigation + state).
- `THIRD_PARTY.md` + `src/vendor/` — vendoring policy + vendored mnemopi.
- `plans/` — implementation plans (incl. `mnemopi-spike-notes.md`).
- `src/` — `subagent.ts`, `index.ts`, `profiles.ts`, `providers.ts`, `memory.ts`.
- `src/vendor/mnemopi/` — ported mnemopi (`db.ts`, `adapters.ts`, core/beam/…).

---

## 2026-08-10 — Eval-benefits (plan: `plans/eval-benefits.md`) — COMPLETE

This section records the eval setup, results, and verdicts. Milestone 1
(instrument `runSubagent` to surface child usage) and Milestones 2–4 (the live
eval matrix across two projects) are all **done**. Raw run artifacts live in
`eval/` and `/tmp/eval/`.

### Milestone 1 — DONE

- `src/subagent.ts`: new exported pure helper `sumUsage(messages: AgentMessage[]):
  Usage` sums `usage` across assistant turns (skips user/toolResult).
  `SubagentResult` now carries `usage?: Usage`, set after `session.prompt()`.
- `src/coordinator.ts`: `CoordinatorResult` now carries `plannerUsage?` on every
  status and `executorUsage?` on `executed`, threaded from the child results.
- `src/index.ts`: `task`/`plan` tool `details` include child usage;
  `/plan` and `/reviewer` notify text appends a `child usage:` line.
- `test/subagent-usage.test.ts`: 5 tests (sum across turns, skip non-assistant,
  empty list, optional-field omission, optional-field summation).
- Verify: `npm test` = 36 pass; `npm run check` clean.

### Milestone 2 — Task matrix + baselines (DONE)

**Pi CLI flags smoke-check (2026-08-10):** all three confirmed present in
`pi --help` — `--no-extensions`/`-ne`, `--no-skills`/`-ns`,
`--no-context-files`/`-nc`. Used as-is.

**Projects (throwaway sandbox copies in `/tmp/eval/`, reset per run — the
plan's "fresh sandbox checkout per run"; the real trees were never touched,
which also satisfies the workspace hazard warning):**
- **P1 — pi-fleet** (TS library): copy of this repo.
- **P2 — bursa-futures** (Python, 15 source files): a real `~/Projects`
  project, different shape from pi-fleet, small enough to plant a verifiable
  T3 bug. (tradingjournal/FCPO were too large to plant+verify a controlled bug
  reliably — a controlled, judgeable bug keeps the eval repeatable, which the
  plan requires.)

**Provider pin:** `neuralwatt/kimi-k2.6` — a real cloud provider that reports
`cacheRead`/`cacheWrite`. (The default `PI_MODEL=glm-5.2:cloud` routes through
local ollama with `cacheRead=0` — exactly the no-cache path the plan forbids
for the cache dimension — so it was deliberately overridden. Local ollama was
not used as a row.)

**Run protocol (both modes, same model):**
- Baseline (vanilla pi inline): `pi --no-extensions --no-skills --no-context-files --model neuralwatt/kimi-k2.6 --mode json -p "<task>"` in the sandbox cwd.
- pi-fleet: `pi -e /Users/amirinns/Projects/pi-fleet/src/index.ts --no-skills --no-context-files --model neuralwatt/kimi-k2.6 --mode json -p "<task, phrased to delegate via the task/plan/remember+recall tools>"`. pi loads the TS extension directly via `-e`.
- Sandbox file state reset before each run; JSON stream captured per run.
- **Parent final input = last assistant turn's `input + cacheRead`** (kimi reports per-turn `input` as the *uncached* portion only; real context size = input + cacheRead — correcting this is what made the T2 result match the Option A spike).
- Total tokens = parent stream sum + child-usage aggregate (Milestone 1).
- **T3 cache series:** run via a direct-coordinator harness
  (`eval/t3_series.ts`: `runPlanExecute` with `approve: async()=>true` and the
  stable `pi-fleet.planner`/`pi-fleet.executor` sessionIds, 3× in one process),
  NOT the interactive `/plan` TUI — the `plan` *tool* is fail-closed without an
  interactive approver, so this is the only way to get the executor to actually
  run non-interactively. The approval is deterministic (`true`) on all 3 runs,
  keeping the executor prefix byte-stable. The planted bug is reset to an
  identical state before each run so the planner/executor read the same file
  content each time.

**Tasks (same wording, run both ways; T2 used an unambiguous marker-comment
edit since the original `sumUsage` already had a JSDoc):**

| Id | Wording | Expected |
| -- | ------- | -------- |
| T1 | Create `math.{ts,py}` with `add(a,b)` and `multiply(a,b)`. | pi-fleet loses (overhead) |
| T2 | Read 3 files, then add a marker comment line above a target function. | parent context smaller for pi-fleet; total cost TBD |
| T3 | Fix a planted read-before-edit bug (markers.ts typo / off-by-one). 3× for the cache series. | does `cacheRead` climb across repeats? |
| T4 | `remember` a fact; in a FRESH session `recall` it and act on it. | recall surfaces the fact; vanilla has no persistence |
### Milestone 3 — Results (LIVE RUNS, completed 2026-08-10)

Provider: `neuralwatt/kimi-k2.6` (real cloud; reports `cacheRead`/`cacheWrite`).
P1 = pi-fleet copy (TS), P2 = bursa-futures copy (Python). Sandboxes in `/tmp/eval/`.
Columns: wall | parent final input | total tokens (parent+child) | cacheRead (parent+child) | cacheWrite | cost | rework | quality.
`rework` = parent turns after the first edit/write (non-interactive `-p`, so no human follow-ups; a proxy for self-correction). For pi-fleet the parent does one delegation, so parent rework is structurally ~0; the child's internal turns are opaque from the parent stream.

#### P1 — pi-fleet (TS)

| Task | Mode | Wall | Parent input | Total tokens | cacheRead | cacheWrite | Cost | Rework | Quality |
|-----|------|-----:|------------:|------------:|----------:|----------:|----:|------:|---------|
| T1 trivial | vanilla pi | 3s | 1,288 | 2,591 | 1,232 | 0 | $0.0014 | 0 | pass |
| T1 trivial | pi-fleet | 6s | 2,211 | 15,807 | 11,024 | 0 | $0.0045 | 0 | pass |
| T2 explore-then-act | vanilla pi | 14s | 8,399 | 34,169 | 25,472 | 0 | $0.0094 | 1 | pass |
| T2 explore-then-act | pi-fleet | 23s | 2,314 | 63,432 | 47,440 | 0 | $0.0166 | 0 | pass |
| T3 multi-step fix | vanilla pi | 4s | 2,408 | 6,038 | 4,416 | 0 | $0.0017 | 0 | pass |
| T3 multi-step fix | pi-fleet | 17s | 4,449 | 41,243 | 30,304 | 0 | $0.0106 | 0 | pass |
| T4 remember | pi-fleet | 3s | 2,090 | 4,191 | 3,776 | 0 | $0.0007 | 0 | (store) |
| T4 recall | pi-fleet (fresh) | 4s | 2,145 | 6,299 | 5,776 | 0 | $0.0008 | 0 | pass |
| T4 recall | vanilla pi | 8s | 10,298 | 28,325 | 18,480 | 0 | $0.0081 | 0 | wrong/unknown (no persistence) |

#### P2 — bursa-futures (Python)

| Task | Mode | Wall | Parent input | Total tokens | cacheRead | cacheWrite | Cost | Rework | Quality |
|-----|------|-----:|------------:|------------:|----------:|----------:|----:|------:|---------|
| T1 trivial | vanilla pi | 2s | 1,238 | 2,489 | 2,160 | 0 | $0.0005 | 0 | pass |
| T1 trivial | pi-fleet | 7s | 2,160 | 17,936 | 14,352 | 0 | $0.0034 | 0 | pass |
| T2 explore-then-act | vanilla pi | 8s | 12,686 | 39,084 | 26,960 | 0 | $0.0096 | 0 | pass |
| T2 explore-then-act | pi-fleet | 10s | 2,207 | 56,372 | 43,744 | 0 | $0.0103 | 0 | pass |
| T3 multi-step fix | vanilla pi | 19s | 9,379 | 46,658 | 36,096 | 0 | $0.0126 | 0 | pass |
| T3 multi-step fix | pi-fleet | 43s | 9,372 | 85,498 | 59,648 | 0 | $0.0306 | 0 | pass |
| T4 remember | pi-fleet | 3s | 2,010 | 4,026 | 3,776 | 0 | $0.0004 | 0 | (store) |
| T4 recall | pi-fleet (fresh) | 5s | 2,121 | 6,258 | 5,792 | 0 | $0.0007 | 0 | pass |
| T4 recall | vanilla pi | 8s | 3,003 | 11,124 | 8,256 | 0 | $0.0027 | 0 | wrong/unknown (no persistence) |

#### T3 — 3× cache series (P1, direct coordinator, stable `sessionId`s)

| Repeat | Wall | Planner in/out/cacheRead | Executor in/out/cacheRead |
|-------:|-----:|--------------------------|---------------------------|
| 1 | 34s | 6,894/639/12,160 | 13,840/2,308/45,216 |
| 2 | 11s | 2,323/399/16,864 | 4,437/493/24,624 |
| 3 | 20s | 4,299/1,185/50,432 | 4,965/280/19,360 |

- **Planner cacheRead: 12,160 → 16,864 → 50,432 — CLIMBS** (4× over 3 runs).
- **Executor cacheRead: 45,216 → 24,624 → 19,360 — NOT monotonic.**

Core-differentiator check: does `cacheRead` climb across repeats 1→3 with the
stable `sessionId`s? **Yes for the planner (confirmed by real numbers); no
(monotonic) for the executor.** See the verdicts for why.

#### Raw breakdown (parent vs child, for the verdicts)

| Cell | parent_in | parent_out | parent_cacheRead | parent_turns | child_in | child_out | child_cacheRead |
|------|----------:|----------:|----------------:|------------:|---------:|---------:|---------------:|
| p1.t1.base | 1,183 | 176 | 1,232 | 2 | 0 | 0 | 0 |
| p1.t1.fleet | 366 | 255 | 3,808 | 2 | 3,950 | 212 | 7,216 |
| p1.t2.base | 7,368 | 1,329 | 25,472 | 5 | 0 | 0 | 0 |
| p1.t2.fleet | 375 | 396 | 3,920 | 2 | 13,400 | 1,821 | 43,520 |
| p1.t3.base | 1,376 | 246 | 4,416 | 3 | 0 | 0 | 0 |
| p1.t3.fleet | 2,692 | 754 | 18,000 | 6 | 7,026 | 467 | 12,304 |
| p2.t1.base | 203 | 126 | 2,160 | 2 | 0 | 0 | 0 |
| p2.t1.fleet | 313 | 200 | 3,808 | 2 | 2,896 | 175 | 10,544 |
| p2.t2.base | 11,629 | 495 | 26,960 | 4 | 0 | 0 | 0 |
| p2.t2.fleet | 255 | 259 | 3,936 | 2 | 11,730 | 384 | 39,808 |
| p2.t3.base | 8,454 | 2,108 | 36,096 | 7 | 0 | 0 | 0 |
| p2.t3.fleet | 7,517 | 2,788 | 18,672 | 4 | 13,281 | 2,264 | 40,976 |

### Milestone 4 — Verdicts

One verdict per dimension (win / loss / conditional) with the evidence row.

1. **Parent cleanliness — CONDITIONAL WIN.** Wins clearly on explore-then-act:
   T2 parent final context 2,314 vs 8,399 (P1, ~6k smaller) and 2,207 vs 12,686
   (P2, ~10k smaller) — the 3 file reads happened in the child and were
   discarded, exactly the Option-A finding. **Loses on trivial**: T1 parent
   2,211 vs 1,288 (P1) and 2,160 vs 1,238 (P2) — the subagent's narrative answer
   is bulkier than the raw inline result. The win is real **but only
   materializes when the subagent does substantial exploration that gets thrown
   away.**
2. **Total cost — LOSS.** pi-fleet costs more total tokens (parent+child) on
   every task: T1 ~6–7×, T2 ~1.4–1.9×, T3 ~1.8–6.8×. The child re-establishes
   its own context (system prompt + tools + reads), so isolation has a real
   price. The parent-cleanliness win is bought with a total-token loss.
3. **Cache efficiency — CONDITIONAL WIN.** The core differentiator is
   **confirmed for the planner**: with the stable `sessionId`, planner
   `cacheRead` climbs 12,160 → 16,864 → 50,432 (4×) across 3 repeated calls.
   **Refuted (as monotonic) for the executor**: 45,216 → 24,624 → 19,360 — its
   prefix includes the *plan text*, which varies across runs, so its prefix
   cache is not stable. The differentiator is real for the read-only, stable
   planner leg; the executor leg needs plan-text stability to benefit.
   *Caveat:* without a no-sessionId control I can't fully isolate "stable
   sessionId" from kimi's automatic prefix caching; the observed climbing is the
   designed behaviour and it works, but the control is the cheapest next
   experiment to pin the cause.
4. **Plan quality / rework — INCONCLUSIVE (no advantage shown).** Both modes
   fixed every bug first-try (rework 0). The "premature-edit trap" did not
   materialise: the tasks *described* the bug, which nudged both modes to read
   before editing, so there was no blind-edit rework for `/plan` to avoid. The
   planner/executor split ran clean (one planner pass → one executor pass) but
   did not reduce turns vs inline here. A genuine trap (ambiguous symptom where
   editing blind causes rework) is needed to test this dimension.
5. **Memory — WIN.** `remember` stored the fact; `recall` in a FRESH session
   retrieved the exact value and acted on it, in both projects (quality: pass).
   Vanilla has no persistence and failed both (P1 rambled; P2 wrote the wrong
   delimiter). Clean capability win, publish-ready.

**Win/loss boundary (task shapes):** pi-fleet **wins** on exploration-heavy work
where the child's reading is discarded (T2: cleaner parent) and on
cache-repeated planner research (T3 planner: cacheRead climbs); **loses** on
trivial one-shots (T1: bulkier parent, higher total cost) and on total-token
cost generally (isolation overhead). Memory is a flat win. Plan-quality/rework
advantage is unproven.

**Keep investing? — CONDITIONAL YES.** The core differentiator (cache-stable
planner) is confirmed by real numbers (cacheRead 4× climb); memory works; parent
cleanliness wins on the explore-then-act shape that motivated the project. The
consistent total-cost loss is the expected price of isolation and is acceptable
for long, exploration-heavy, multi-step sessions (not trivial one-shots).
Cheapest next experiment to flip the borderline: (a) a **no-sessionId control**
on the T3 series (random child sessionIds) — if cacheRead still climbs, the win
is kimi's auto-cache, not the stable sessionId, and the differentiator claim
weakens; (b) a **genuine premature-edit trap** (ambiguous symptom) to test
whether `/plan` reduces rework vs inline.

**Publish/dogfood? — CONDITIONAL: dogfood YES (exploration-heavy/multi-step),
publish NOT YET.** Dogfooding is warranted on the shapes where pi-fleet wins
(explore-then-act, cache-repeated planning, memory). Before publishing as a
general tool, three things should be true: (1) the **executor cache
instability** is addressed — the executor's prefix includes the variable plan
text, so it doesn't benefit from the stable sessionId the way the planner does
(consider canonicalising the plan, or documenting planner-only caching); (2)
the **total-cost overhead** is documented as the explicit trade for parent
cleanliness so users pick pi-fleet for the right tasks; (3) a **genuine
premature-edit trap** shows a real rework reduction. Memory is publish-ready
today.

> The keep-invest / dogfood decision is recorded in `docs/decisions.md`.
---

## 2026-08-10 — Follow-up experiments (hardening the verdict)

Two experiments run to resolve the borderline findings from Milestone 4.

### Experiment A — No-sessionId control (the cache cause)

The T3 series showed planner `cacheRead` climbing 12,160 → 16,864 → 50,432 with
the **stable** `pi-fleet.planner` sessionId. The control asks: is that climb
caused by the stable sessionId (provider session-affinity routing to one warm
cache node), or would it happen with ANY sessionId (kimi's automatic,
session-agnostic prefix caching)?

Method (`eval/t3_control.ts`): run the **planner** subagent 3× with a STABLE
sessionId, then 3× with a RANDOM (unique-per-call) sessionId, resetting the
planted bug to an identical state before each call. 3 trials of each.

| Trial | STABLE cacheRead series | RANDOM cacheRead series |
|------:|-------------------------|-------------------------|
| 1 | 16,864 / 10,464 / 34,464 | 16,848 / 16,848 / 38,080 |
| 2 | 16,880 / 24,320 / 26,704 | 17,392 / 19,680 / 39,376 |
| 3 | 16,864 / 10,464 / 34,464 | 16,848 / 16,848 / 38,080 |

- STABLE: monotonic climb **1/3**; run3 > run1 **3/3**; end/run1 ratio ~1.6–2.0×.
- RANDOM: monotonic climb **3/3**; run3 > run1 **3/3**; end/run1 ratio **2.26×** (every trial).

**Result: the cacheRead climb is NOT caused by the stable sessionId.** Random
sessionIds climb just as much — in fact more consistently (3/3 monotonic vs
1/3). The warming is kimi's automatic, session-agnostic **prefix caching** keyed
on prefix *content*, not session affinity. The stable `sessionId` confers **no**
cache advantage on this provider.

**Revised understanding of the cache win.** Reasonix/pi-fleet's cache stability
is really two claims: (1) **don't mutate the prefix** (keep system prompt + tools
byte-stable) so the provider's automatic content-keyed prefix cache stays warm;
(2) **stable sessionId** pins to one cache node for cross-call warmth. Claim (1)
is valid and is what the T3 climbing demonstrates — pi-fleet's fixed profile
prompts keep the prefix stable. Claim (2) is **refuted on kimi**: the sessionId
is not the mechanism. It might matter on a provider that genuinely routes by the
`x-session-affinity` header (untested — e.g. DeepSeek's node-routed cache), but
on kimi the cache is content-keyed and global.

### Experiment B — Premature-edit trap (the plan-quality dimension)

Milestone 4's plan-quality verdict was "inconclusive" because T3 *described* the
bug, nudging both modes to read first. A genuine trap was built
(`eval/trap/eval_target.ts` + test): a `shipping()` function where the standard
branch uses the wrong free-weight threshold (`weight - 5` instead of `weight -
3`). The naive blind fix (raise the base $8 → $10) passes some test cases but
fails the under-threshold case → would force rework. The correct fix (threshold
5 → 3) passes all.

Run both ways, 3× each, with the task telling the model to run the test:

| Mode | run | quality | wall | turns | edits | rework | bash (test) |
|------|----:|---------|-----:|------:|------:|-------:|------------:|
| base | 1 | pass | 6.8s | 4 | 1 | 0 | 2 |
| base | 2 | pass | 6.5s | 5 | 1 | 0 | 2 |
| base | 3 | pass | 8.0s | 6 | 1 | 0 | 3 |
| fleet | 1 | pass | 22.9s | 5 | 0 | 0 | 2 |
| fleet | 2 | pass | 43.5s | 2 | 0 | 0 | 0 |
| fleet | 3 | pass | 25.4s | 3 | 0 | 0 | 1 |

Baseline did **read → 1 correct edit → verify**, every time — no premature edit.
Harder variant (task does **not** mention the test, 3 baseline runs): still
`read → edit → pass`, 0 rework, every time. kimi-k2.6 reads before editing
regardless of framing.

**Result: the premature-edit trap does not trigger with kimi-k2.6.** The model is
careful enough to read-before-edit in both modes, so there is no rework for
`/plan` to avoid. The plan-quality/rework advantage cannot be demonstrated with
this model — it would need a less careful model or explicit time pressure.

### Revised verdicts (delta vs Milestone 4)

- **Cache efficiency — REVISED: LOSS of the sessionId mechanism; the content-stability cache win is real but not pi-fleet-specific.** The stable `sessionId` does NOT cause the cacheRead climb (Experiment A). The climb is kimi's automatic content-keyed prefix cache, which any repeated call with a stable *prefix* enjoys. pi-fleet's fixed profile prompts keep the prefix stable (valid), but the "stable sessionId" design — the named "core differentiator" — adds no cache value on kimi. It may on a session-affinity-routed provider (untested).
- **Plan quality / rework — CONFIRMED inconclusive (now with a dedicated trap).** Experiment B shows kimi-k2.6 reads before editing in both modes; no rework to reduce. Not a loss (both modes succeed), just no demonstrated advantage.
- Parent cleanliness (T2), total cost, and memory verdicts are **unchanged** — they don't depend on the sessionId mechanism.

### Revised recommendation

- **Keep investing: CONDITIONAL YES, but narrower.** The parent-cleanliness win (explore-then-act) and the memory win still hold and are worth keeping. The "cache-stable sessionId" differentiator is **not** validated as a pi-fleet effect on kimi — the real cache lever is prefix content-stability (don't mutate the system prompt), which is a weaker, more general claim. Before further investment in the cache story, test on a provider that genuinely routes by `x-session-affinity` (e.g. DeepSeek); if the stable sessionId still doesn't beat random there, drop the sessionId mechanism as a differentiator and reframe around prefix content-stability + parent cleanliness + memory.
- **Publish/dogfood: unchanged — dogfood YES (explore-then-act, memory); publish NOT YET.** The two new blockers from Milestone 4 (executor cache instability, plan-quality rework) are now sharper: the executor cache instability is explained (its variable plan text breaks content-stability, the actual cache lever); the plan-quality advantage is unproven with careful models. Memory remains publish-ready.

### Experiment A2 — No-sessionId control on DeepSeek (the session-affinity provider)

DeepSeek was the provider the original design expected to route by the
`x-session-affinity` header. Ran the same control (`eval/t3_control.ts`,
`EVAL_MODEL=deepseek/deepseek-v4-flash`) 3 trials:

| Trial | STABLE cacheRead | RANDOM cacheRead |
|------:|------------------|------------------|
| 1 | 33,408 / 39,552 / 29,440 | 29,184 / 33,024 / 43,264 |
| 2 | 20,096 / 55,552 / 41,728 | 29,312 / 40,960 / 30,592 |
| 3 | 68,864 / 42,496 / 29,568 | 44,416 / 40,704 / 29,440 |

- STABLE: monotonic climb **0/3**; run3 > run1 **1/3**; ratios 0.88 / 2.08 / 0.43.
- RANDOM: monotonic climb **1/3**; run3 > run1 **2/3**; ratios 1.48 / 1.04 / 0.66.
- DeepSeek reports `cacheRead` (non-zero) but it is **volatile**, not
  monotonically accumulating — the first call often already hits a warm
  content-keyed cache (DeepSeek's prefix cache is automatic and content-keyed,
  not session-routed).

**Result: on DeepSeek, NEITHER stable nor random sessionIds climb reliably.**
The stable sessionId does **not** produce cross-call cache warming on the very
provider the design expected to route by it.

### Cross-provider conclusion on the cache differentiator

Tested on two cache-reporting providers:

| Provider | STABLE climbs? | RANDOM climbs? | sessionId helps? |
|----------|:-:|:-:|:-:|
| kimi (neuralwatt/kimi-k2.6) | 1/3 monotonic | 3/3 monotonic (2.26×) | **No** — random ≥ stable |
| DeepSeek (deepseek-v4-flash) | 0/3 monotonic | 1/3 monotonic | **No** — neither climbs reliably |

**The "stable sessionId → cross-call cache warming" mechanism is refuted on both
providers tested.** Neither routes by the `x-session-affinity` header in a way
that produces cache warming beyond automatic content-keyed prefix caching. The
cache win that *does* exist is prefix **content-stability** (don't mutate the
system prompt + tools) — which pi-fleet's fixed profile prompts achieve, but
which is a general property any repeated call with a stable prefix enjoys, not a
pi-fleet-specific differentiator.

**Reframe:** pi-fleet's validated value is **(1) parent cleanliness on
explore-then-act** (T2: 6–10k smaller parent context — the child's reads are
discarded), **(2) memory** (T4: recall in a fresh session; vanilla has no
persistence), and **(3) prefix content-stability** (fixed profile prompts keep
the provider's auto-cache warm — a real but general lever, not the sessionId
mechanism). The named "core differentiator" — the cache-stable planner/executor
split via stable sessionIds — is **not** validated as a sessionId effect and
should be dropped from the value proposition unless a provider that genuinely
honours `x-session-affinity` is found and tested positive.

## 2026-08-10 — Multi-model extension (3 models, 2 providers)

Extended the eval across the requested model matrix to check whether the
verdicts are model-robust or a kimi artifact:

- **ollama** provider: GLM (`glm-5.2:cloud`), Kimi (`kimi-k2.6:cloud`)
- **deepseek** provider: DeepSeek (`deepseek-v4-flash`)

Tasks T1 (trivial), T2 (explore-then-act), T4 (memory) on P1, both modes.
`pFin` = parent final context (last turn input+cacheRead). ollama models report
`cacheRead=0` (no cache visibility) — the cache dimension is only testable on
DeepSeek / neuralwatt-kimi; ollama confirms the no-cache row.

#### T2 — explore-then-act (parent cleanliness; the key win)

| Model | Mode | pFin | total tokens | cacheRead | cost | quality |
|-------|------|----:|------------:|----------:|----:|:-------|
| GLM (ollama) | vanilla | 6,259 | 13,978 | 0 | $0.0000 | pass |
| GLM (ollama) | pi-fleet | 2,712 | 33,288 | 0 | $0.0000 | pass |
| Kimi (ollama) | vanilla | 6,809 | 27,607 | 0 | $0.0000 | pass |
| Kimi (ollama) | pi-fleet | 2,047 | 101,488 | 0 | $0.0000 | pass |
| DeepSeek (deepseek) | vanilla | 7,267 | 23,411 | 17,408 | $0.0010 | pass |
| DeepSeek (deepseek) | pi-fleet | 3,625 | 84,831 | 69,760 | $0.0027 | pass |

#### T1 — trivial (overhead floor)

| Model | Mode | pFin | total tokens | cost | quality |
|-------|------|----:|------------:|----:|:-------|
| GLM (ollama) | vanilla | 1,463 | 2,953 | $0.0000 | pass |
| GLM (ollama) | pi-fleet | 2,684 | 17,563 | $0.0000 | pass |
| Kimi (ollama) | vanilla | 1,218 | 2,445 | $0.0000 | pass |
| Kimi (ollama) | pi-fleet | 1,950 | 15,043 | $0.0000 | pass |
| DeepSeek (deepseek) | vanilla | 1,751 | 3,531 | $0.0003 | pass |
| DeepSeek (deepseek) | pi-fleet | 3,046 | 26,627 | $0.0014 | pass |

#### T4 — memory (recall in a fresh session)

| Model | Step | pFin | total tokens | cost | quality |
|-------|------|----:|------------:|----:|:-------|
| GLM (ollama) | remember (fleet) | 2,540 | 5,103 | $0.0000 | (store) |
| GLM (ollama) | recall (fleet, fresh) | 2,604 | 7,726 | $0.0000 | pass |
| GLM (ollama) | recall (vanilla) | 4,493 | 12,346 | $0.0000 | wrong/unknown |
| Kimi (ollama) | remember (fleet) | 1,819 | 3,639 | $0.0000 | (store) |
| Kimi (ollama) | recall (fleet, fresh) | 1,961 | 5,756 | $0.0000 | pass |
| Kimi (ollama) | recall (vanilla) | 9,511 | 56,033 | $0.0000 | wrong/unknown |
| DeepSeek (deepseek) | remember (fleet) | 2,868 | 5,762 | $0.0001 | (store) |
| DeepSeek (deepseek) | recall (fleet, fresh) | 3,038 | 8,935 | $0.0001 | pass |
| DeepSeek (deepseek) | recall (vanilla) | 17,315 | 90,595 | $0.0028 | wrong/unknown |

#### Cross-model summary

| Dimension | ollama-GLM | ollama-Kimi | deepseek-DeepSeek | verdict |
|-----------|:----------:|:-----------:|:-----------------:|:--------|
| T2 parent cleanliness (base−fleet pFin) | 3,547 | 4,762 | 3,642 | **WIN on all 3** |
| T1 overhead (fleet−base pFin) | +1,221 | +732 | +1,295 | **LOSS on all 3** |
| T2 total-token cost (fleet/base) | 2.4× | 3.7× | 3.6× | **LOSS on all 3** |
| T4 memory (recall pass, base fail) | yes | yes | yes | **WIN on all 3** |
| cacheRead reported? | no (0) | no (0) | yes | only DeepSeek testable |

### Multi-model conclusion

**The verdicts are model-robust, not a kimi artifact.** Across all three models
and both providers:

- **Parent cleanliness on explore-then-act (T2) is a consistent win** — pi-fleet's
  parent is 3.5–4.8k tokens smaller on every model (the child's reads are
  discarded). This is the real, model-agnostic, pi-fleet-specific value.
- **Memory (T4) is a consistent win** — recall in a fresh session retrieves the
  fact on every model; vanilla fails on every model. Publish-ready.
- **Trivial one-shots (T1) are a consistent loss** — pi-fleet's parent is bulkier
  and total cost is higher on every model.
- **Total-token cost is a consistent loss** — isolation overhead (the child
  re-establishes its own context) is 2.4–3.7× on T2 across all models.
- **The cache dimension is only testable on DeepSeek** (ollama reports
  `cacheRead=0`). DeepSeek reproduces the earlier finding: stable sessionId does
  not confer a cache advantage (Experiment A2).

The multi-model run **reinforces the reframe**: pi-fleet's validated,
model-agnostic value is **parent cleanliness on exploration-heavy work +
persistent memory**, at a **total-token cost** that's worth it only for
non-trivial, exploration-heavy, multi-step sessions. The cache-stable sessionId
mechanism remains refuted on every provider that reports cache.

## 2026-08-10 — Improvements: implemented + NeuralWatt fast-model trap

### Implemented (evidence-backed, small)
1. **Reframe (docs)** — the value prop now leads with "cleaner parent thread +
   persistent memory + isolated subagents"; the refuted sessionId cache claim
   is dropped (see the A2 / cross-provider sections above).
2. **Tool-description guidance** (`src/index.ts`) — `task`/`plan` descriptions
   now say "best for exploration-heavy/multi-step work; do NOT use for trivial
   one-shot edits — do those inline." Nudges the model away from the T1
   overhead floor.
3. **Executor verification step** (`src/profiles.ts`) — the executor profile now
   says "Before declaring done, VERIFY your change (run the test/lint/build, or
   re-read the edited code) and report the result." Makes the plan-quality
   dimension real instead of incidental.
4. **Streamlined profile prompts** (`src/profiles.ts`) — reviewer/planner/
   executor prompts trimmed to the minimum (markers preserved on the planner;
   marker behaviour unit-tested, 36 tests still pass).

### Deferred to a plan (compaction ladder)
5. A full graduated compaction ladder is a real feature needing its own pass,
   and the eval's short `-p` runs don't trigger compaction (so benefit is
   unmeasured). Written as `plans/compaction-ladder.md` — smallest useful scope
   = the no-LLM "snip" tier (elide stale tool results via
   `session_before_compact` before pi's summarize). The LLM-summarize tier is
   gated behind a measured long-session benchmark.

### Experiment A3 — Premature-edit trap on fast (less-careful) NeuralWatt models
The earlier trap (Experiment B) used careful kimi-k2.6 and didn't trigger. To
test whether a *less careful* model would edit blind (giving `/plan` a rework
   advantage), ran the same trap on three fast/non-thinking NeuralWatt models,
both modes, 3 trials each (18 runs):

| Model | Mode | rework (3 runs) | quality (3 runs) |
|-------|------|:---------------:|:----------------:|
| neuralwatt/kimi-k2.6-fast | base | 0, 0, 0 | pass, pass, pass |
| neuralwatt/kimi-k2.6-fast | fleet | 0, 0, 0 | pass, pass, pass |
| neuralwatt/glm-5.1-fast | base | 0, 0, 0 | pass, pass, pass |
| neuralwatt/glm-5.1-fast | fleet | 0, 0, 0 | pass, pass, pass |
| neuralwatt/qwen3.6-35b-fast | base | 0, 0, 0 | pass, pass, pass |
| neuralwatt/qwen3.6-35b-fast | fleet | 0, 0, 0 | pass, pass, pass |

**Result: the trap does not trigger on ANY fast model either.** Every run read
the target + test first, then fixed correctly (0 rework, all pass). Across 4
models total (careful kimi-k2.6 + 3 fast), the premature-edit trap never fired.

**Side finding — pi-fleet adds latency on fast models:** fleet wall time was
higher than base on every fast model (kimi-fast 14–21s vs 6–9s; glm-fast 20–49s
vs 8–15s; qwen-fast 22–180s vs 5–8s — one qwen run hit 180s). The
planner→executor split costs extra round-trips; on fast models that latency
overhead is more visible relative to the cheap base run. This reinforces: use
pi-fleet for exploration-heavy/multi-step work, not trivial or latency-sensitive
tasks.

### Plan-quality dimension — final verdict
**The plan-quality/rework advantage is not demonstrable with current models.**
Every model tested (careful and fast, across kimi/GLM/qwen/DeepSeek) reads
before editing when a test/verification is available, so there is no rework
for `/plan` to avoid. The executor verification step (#3) is the right
mitigation: it makes verification explicit (helps less-careful models that
might skip it) rather than relying on the model being careful. The
plan-quality claim should be "the executor always verifies," not "reduces
rework vs inline."

## 2026-08-11 — Community reality-check (reddit-recon)

Ran `reddit-recon` (recon-tools) against r/PiCodingAgent, r/codex, r/hermesagent,
r/LocalLLaMA, r/SideProject. Queried the shared `recon.db` (3,302 posts) then
scraped r/PiCodingAgent for "subagent" (50 posts) and a global "coding agent
memory" search (50 posts). The community evidence **confirms pi-fleet's revised
self-assessment almost exactly** — and surfaces the catches the eval couldn't.

### Where the community CONFIRMS pi-fleet's findings

1. **Parent cleanliness is the *only* justified subagent purpose.** The top
   r/PiCodingAgent thread "Do subagents really matter?" — its highest-signal
   comment (score 16): *"The only reason to use subagents is to keep context
   clean. If you are doing it to build some big org chart of agents because you
   think it will be better, you are just playing dolls."* This is **exactly**
   pi-fleet's eval conclusion: T2 parent cleanliness is the one win; the
   planner/executor orchestration is not a validated win. The community
   independently arrived at the same line.
   ([permalink](https://www.reddit.com/r/PiCodingAgent/comments/1vjs5cs/))

2. **The cache lever is prefix content-stability, not session routing —
   confirmed the expensive way.** r/PiCodingAgent "When using Mimo, don't cycle
   through thinking levels": *"The prefix cache is keyed on the full request
   parameters... cost me 253K tokens. Also check your damn extensions (some like
   pi-task or pi-toolkit) inject dynamic messages in your prompts."* And the
   "How do you use plan mode in Pi?" thread: a plan-mode extension *"mostly
   causes cache misses when I exit the plan mode because it edits the context."*
   The community has learned (at 253K-token cost) that **mutating the prefix
   busts the content-keyed cache** — which is pi-fleet's Experiment A2 finding
   (sessionId doesn't help; content-stability does). pi-fleet's fixed-profile +
   separate-session design is the right fix; its dropped sessionId claim is
   community-validated.

3. **Deterministic gates beat review agents.** A Lullabeast (r/LocalLLaMA)
   planner/executor/reviewer commenter (score 3): *"the reviewer agent is
   usually the weakest link because a non-deterministic reviewer will
   rationalize its way past a real failure. Dropping a deterministic gate
   between phases (tests, linter, schema check that has to pass before the
   flow advances) catches the class of regressions a review agent talks itself
   past."* This validates pi-fleet's #3 (executor verification step) AND flags
   pi-fleet's `reviewer` profile (Phase 1) as the weak link.

### The catches (where pi-fleet is weak / contested)

4. **pi-fleet's idea source (oh-my-pi) is widely called "bloat".** Top
   r/PiCodingAgent comment on OMP (score 15): *"My opinion on OMP is that it is
   bloat... the idea with pi is that you start out with exactly 0 plugins until
   you feel pain."* (score 6, 3): *"the more I use omp, the more I wish pi just
   had a better safer extension ecosystem" / "Dont use OMP... start with
   barebone Pi."* The pi ethos is minimal + pain-first. pi-fleet (subagents +
   planner/executor + memory + compaction) risks the "bloat/slop" label unless
   it demonstrates pain-relief (context bloat), not feature-count.

5. **The planner/executor *conversation* loop fails in practice.**
   r/SideProject "oh-my-symphony": *"tried the autonomous-loop pattern... planner,
   executor, critic talking to each other politely while not actually shipping.
   killed it on the third recursive replan of the same task."* Their fix: a
   state machine (kanban) where *"agents never talk to each other. they only
   talk to tickets."* pi-fleet's coordinator is a planner→executor conversation;
   it's simpler (no critic, no recursive replan, one pass) so it dodges the
   worst failure, but the community clearly prefers deterministic state/gates
   over agent conversation for coordination.

6. **Simpler competitors already get pi-fleet's wins.**
   - **Fork-from-stable-prefix** (r/PiCodingAgent "My powerful Pi agent Setup"):
     *"Reading the plan into context, then continually branching the tree to
     implement each task in the plan from one stable trunk prefix"* + an
     observational-memory extension. This achieves cache-stability + parent
     cleanliness via session **forking**, no coordinator — a direct, simpler
     competitor for pi-fleet's cache+cleanliness story.
   - **Plan skill + `/handoff` to a fresh session** (top comment score 9 on the
     plan-mode thread): the community's plan mode is a skill file + a fresh
     session, cheaper than pi-fleet's coordinator, and gets the same
     parent-cleanliness.
   - **pi-subagents** (tintinweb, nicobailon), **pi-agent-continuity**,
     **pi-observational-memory**: subagent + memory + continuity extensions
     already exist for pi. pi-fleet is not the first or only.

7. **pi-fleet's cost story is the weak dimension, and the community's cost fix
   is different.** r/hermesagent "You're probably accidentally tokenmaxxing"
   ($150/2 wks unsustainable): the fix = a **model router** (Manifest:
   classify complexity → route to the cheapest model) + free tiers. pi-fleet
   does NOT route models (inherits `ctx.model`); the eval showed total cost is
   a consistent LOSS. The community's actual cost lever (routing + free tiers)
   is something pi-fleet doesn't do.

8. **Memory bloats/degrades without consolidation.** Claude Code's "Auto
   Memory" → *"by session 20, your memory file is bloated with noise,
   contradictions, and stale context. The agent actually starts performing
   worse"* → required "Auto Dream" (consolidation). pi-fleet's mnemopi port
   **deferred** consolidation/embeddings. The T4 memory win is real short-term
   but will degrade without that deferred work.

### Is pi-fleet good enough? — community-grounded verdict

- **The thesis is community-refuted.** pi-fleet's named differentiator (the
  cache-stable planner/executor via stable sessionIds) is refuted by pi-fleet's
  own eval (Experiment A2) AND by community experience (the cache is
  content-keyed; the lever is "don't mutate the prefix," which forking and
  fixed-profile skills achieve more simply).
- **The validated value is real but commodity.** Parent cleanliness (T2) and
  memory (T4) are confirmed wins — but existing pi extensions
  (forking, observational-memory, plan-skill+handoff, pi-subagents) already
  deliver them, often more simply. The community's canonical line ("the only
  reason to use subagents is to keep context clean... org charts are playing
  dolls") is a precise match to pi-fleet's narrow win boundary.
- **Net: dogfood-yes, publish-no — and narrower than before.** pi-fleet is good
  enough to *use* (the wins are real and community-validated in shape), but it
  is **not differentiated enough to publish**: simpler competitors get the same
  wins, it risks the "bloat" label in a minimalism-first community, its cost
  dimension is a loss without the routing lever the community uses, and memory
  will degrade without consolidation.

### What this changes vs the eval's reframe
The eval's reframe (drop sessionId; lead with parent-cleanliness + memory) is
**community-confirmed**. But the community adds a sharper constraint the eval
missed: **most of pi-fleet could be a skill file + forking, not an extension.**
The strongest path is to strip pi-fleet to the minimal pain-relief (parent-clean
delegation + memory-with-consolidation) and position explicitly against the
"bloat" risk — or pivot to the one lever the community uses that pi-fleet
lacks: **model routing** (cheap model for simple work, frontier for hard),
which would actually attack the cost dimension instead of accepting it as a
loss.

## 2026-08-11 — r/PiCodingAgent recon: cache thesis validated in the wild

**Explored:** scraped 100 posts from r/PiCodingAgent (full listing, newest sort,
top 5 comments each; archived in recon.db) and reflected pi-fleet's pitch against
what the community actually says.

**Key findings:**
- Prefix-cache instability is a live, felt pain — and existing extensions cause
  it: the pi-plan-mode author admits his extension "mostly causes cache misses" by
  editing context on plan-mode exit; a Mimo user lost 253K tokens to a cache-key
  change and warns that pi-task/pi-toolkit "inject dynamic messages in your
  prompts". This is exactly pi-fleet's prefix-stability invariant.
- The community is cache-literate and wary of mid-session model mutation: top
  question on Pi-Bifrost (per-prompt routing) is "Does this destroy the cache?"
  pi-fleet's separate-Agent / stable-sessionId architecture is the clean answer.
- Subagent pain is concrete: pi-subagents called unstable ("stuck, broken, slow")
  and "burned credits like crazy"; users hand-roll planner/executor via
  plan → PLAN.md → /handoff → fresh session, and warn against a model reviewing
  its own work. Direct demand signal for the cache-aware subagents + split.
- Anti-bloat ethos dominates: "start with zero plugins, add only when you feel
  pain" ("Arch Linux of coding harnesses"). Features must be independently
  enable-able or adoption stalls.
- Guardian is the least differentiated feature: pi-automode (rules + classifier)
  and pi-sandbox are established. Memory is crowded too (Engram 136↑,
  pi-observational-memory, pi-llm-wiki) — mnemopi is hygiene, not a pitch.
- Model-agnosticism validated: wild mix is DeepSeek-V4-Flash-0731 (dominant), K3,
  GLM 5.2, Mimo, Qwen — matches the providers.ts table.

**Open questions / next steps:**
- Demo script from the pain threads: burn credits the naive way, then show the
  cache-hit delta via after_provider_response telemetry.
- Make features individually installable before any public push.

---

## 2026-09-14 — pi 0.85.1 smoke test + Reasonix already on this machine (coding-cache goal moot for pi-fleet)

**Smoke test (pi 0.85.1):** pi-fleet loads and runs despite peer deps pinned
at 0.84.0. `task`-tool delegation to an executor child worked end-to-end in a
/tmp sandbox (child usage 21,386 tokens, cacheRead 13,696; run cost ~$0.0005).
No tool-name conflict with the third-party `subagent` extension already in
`~/.pi/agent/extensions/` (its tool is `subagent`, pi-fleet's is `task`).
`npm run check` clean, 36/36 tests pass.

**Reasonix is already installed here:** v1.19.5 at /opt/homebrew/bin/reasonix,
`~/.reasonix` populated (sessions/stats/config), `reasonix doctor` healthy
(two trivial skill-registry warnings). Its own stats files
(`~/.reasonix/stats/*.jsonl`) prove the cache claim on THIS machine:

| Day | Requests | Cache hit | Cached / missed | Peak ctx |
|-----|---------:|----------:|----------------:|---------:|
| 2026-08-04 | 60 | 98.3% | 3.8M / 65k | 160k |
| 2026-08-05 | 409 | 99.1% | 42.8M / 368k | 426k |
| 2026-09-13 | 1,719 | 99.0% | 456.8M / 4.5M | 841k |

At DeepSeek's ~1/10 cache-read price, effective input cost ≈ 11–12% of uncached.

**Implication for pi-fleet's scope:** the user's coding-cache goal is already
served by Reasonix (purpose-built for DeepSeek prefix-cache stability, verified
99% here). pi-fleet's cache story is moot for coding — own Experiments A/A2
refuted the stable-sessionId mechanism on kimi AND DeepSeek, and pi-fleet's
total-token cost is 1.4–3.7× WORSE (opposite of a cache strategy). dsh
(`npx @deepseek-ai/dsh`, v0.1.5-rc.1) is installable as the official
alternative but adds no cache advantage over Reasonix; its value is the
plugin architecture, not caching.

**Remaining candidate use for pi-fleet:** its memory (`remember`/`recall`) for
open-discussion sessions — validated by the eval (T4 fresh-session recall on
all models; "publish-ready"). Two caveats: (1) it currently ships bundled
with task/plan tools, which is context bloat for non-coding sessions — a
stripped memory-only variant is the right shape; (2) consolidation remains
deferred (mnemopi port dropped it), and discussions accumulate facts faster
than coding, so the degrade-without-consolidation problem arrives sooner.
