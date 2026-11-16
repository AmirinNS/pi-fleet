# Plan: mnemopi feasibility spike + port

## Goal
Decide whether to bring oh-my-pi's `mnemopi` (local SQLite memory engine) into
pi-fleet, then — only if the spike says go — vendor and port it to run on
upstream pi (Node) instead of omp's forked stack. Adds the "background memory"
layer (Context Engine v2 idea) without an `@oh-my-pi/*` runtime dependency.

## Scope
- Phase A (always): a read-only **feasibility spike** producing a written go/no-go
  report. No product code.
- Phase B (conditional on Phase A = go): vendor + port + expose as extension
  tools.
- Out of scope: the working/episodic "sleep" consolidation and ONNX embeddings in
  the first port (stub embeddings behind an interface); MCP server exposure;
  the planner/executor work (separate plan).

## Approach

### Phase A — Feasibility spike (independently shippable: a decision)

#### Milestone A1: Map the surface
1. Read `open-sources/oh-my-pi/packages/mnemopi/src/index.ts` and `README.md`; list the **full** public API. The facade is far larger than remember/recall/stats/sleep — `index.ts` re-exports ~30 functions (addMemory, flushExtractions, forget, get/getBank/setBank, getContext, getDefaultInstance, getStats, query, recall/recallEnhanced, remember, saveMemory/storeMemory, scratchpadClear/Read/Write, search, sleep/sleepAllSessions, update) plus the `core/beam`, `core/embeddings`, `core/llm-backends`, and `core/memory` modules. Record the real export surface, not a summary.
2. Enumerate the **full source tree**, not just the facade: `find packages/mnemopi/src -name '*.ts' | wc -l` and per-file LoC. As of the investigated commit this is 66 files / ~19.7k LoC, with a deep `src/core/` (extraction pipeline, triples, annotations, episodic-graph, polyphonic-recall, veracity-consolidation, query-intent, query-cache, MMR/SHMR reranking, vector-index, binary-vectors, fastembed-runtime, local-llm, llm-backends, orchestrator, plugins, streaming, cost-log, synonyms, temporal-parser, weibull, entities, patterns). List which core subsystems `remember()` and `recall()` transitively import, so the first-port scope (A3) is grounded in the real dependency graph.
3. `grep -rn 'from "@oh-my-pi/' packages/mnemopi/src` — enumerate **all** forked-dep call sites. There are four forked packages, not three: `pi-ai` (~6 files), `pi-utils` (~5), `pi-natives` (3: mmr, shmr, vector-index), **and `pi-catalog/hosts`** (2 call sites: `src/config.ts`, `src/core/embeddings.ts` — used for host/URL matching). Record each call site and what it is used for.
4. `grep -rn 'bun:sqlite\|bun:' packages/mnemopi/src` — enumerate all 21 `bun:sqlite` uses and note which SQLite features they need (prepared stmts, JSON1, FTS5, `vec0` virtual tables via `loadExtension` of `sqlite-vec`).
5. `grep -rn 'Bun\.' packages/mnemopi/src` — enumerate Bun-runtime APIs that are NOT caught by the `bun:` grep. These include `Bun.CryptoHasher` (`src/util/ids.ts` — on the `remember()` id-generation path, replace with `node:crypto`), `Bun.spawnSync` (`src/db.ts` — page-size detection), and `Bun.file`/`Bun.write`/`Bun.Glob` (`src/core/fastembed-*.ts` — deferrable with embeddings). Mark each as core-path or deferrable.
→ Verify: a `plans/mnemopi-spike-notes.md` table listing every external call site (4 forked deps + Bun-runtime APIs) + the SQLite feature set required + the full file/LoC count and the remember/recall transitive import set.

#### Milestone A2: Map replacements
1. For each `@oh-my-pi/pi-ai` use, find the upstream `@earendil-works/pi-ai` equivalent (embeddings API in particular); note gaps.
2. For each `@oh-my-pi/pi-natives` use (mmr/shmr/vector-index — native cosine/vec ops), decide: drop, or replace with a JS implementation (`src/core/vector-math.ts` already has a JS `cosineSimilarity`; MMR/SHMR can be ported in pure JS).
3. For `@oh-my-pi/pi-catalog/hosts` (host/URL matching), replace with a small local helper or inline check — it is a leaf utility, not a runtime coupling.
4. Replace core-path Bun-runtime APIs: `Bun.CryptoHasher` → `node:crypto.createHash`; `Bun.spawnSync` in `db.ts` → `child_process.spawnSync` (or drop page-size auto-detection entirely for the first port). Deferrable Bun APIs (`Bun.file`/`write`/`Glob` in fastembed) go away with the deferred embeddings.
5. Choose the SQLite driver (see Decisions Log): `node:sqlite` vs `better-sqlite3`. Requirements: must ship **FTS5** (mnemopi's recall is hybrid FTS5 + vector; with embeddings deferred, recall degrades to **FTS5-only** in the first port — so FTS5 is a hard requirement, not optional). `better-sqlite3` bundles SQLite with FTS5 enabled; `node:sqlite` (experimental, Node 22+) FTS5 support depends on the Node build — verify before choosing. Note: `vec0` virtual tables come from the runtime-loaded `sqlite-vec` extension via `loadExtension`, **not** from either driver — so vector search is unavailable in the first port regardless of driver, and `recall`'s dense/vec score component is zero (FTS5 + importance only). That degradation is acceptable for the first port and must be stated explicitly in the go/no-go.
→ Verify: the notes file has a 1:1 replacement mapping (covering all 4 forked deps + Bun-runtime APIs) and a driver choice with rationale, including the explicit FTS5-only recall degradation.

#### Milestone A3: Go/no-go
1. Estimate effort (files, LoC touched, native-dep risk) from A1–A2, using the real 66-file/~19.7k-LoC tree, not the facade summary.
2. Decide the **first-port subsystem scope**: which `src/core/` subsystems are included vs stubbed/dropped so that `remember`/`recall` work end-to-end. Recall transitively imports `beam/recall` → embeddings, mmr, query-intent, synonyms, temporal-parser, vector-math; remember transitively imports `beam/store` → `util/ids` (Bun.CryptoHasher), triples, annotations. State explicitly: extraction pipeline (LLM-based) in or out? triples/annotations in or out? episodic-graph/polyphonic-recall/veracity-consolidation in or out? Default minimal scope = beam store + FTS5 recall + ids, with embeddings/MMR/extraction stubbed.
3. Write the verdict into `THIRD_PARTY.md` (candidates table) and a decision into `docs/decisions.md`: go/no-go + first-port subsystem scope + FTS5-only recall degradation.
→ Verify: a recorded decision with an explicit in/out subsystem list. **Stop here if no-go.**

### Phase B — Port (only if Phase A = go)

#### Milestone B1: Vendor raw
1. Copy needed `mnemopi/src` files into `src/vendor/mnemopi/`, preserving MIT headers.
2. Add the row to `THIRD_PARTY.md` (source repo, exact commit, license, "changes: pending").
3. Add `src/vendor/mnemopi/` to `tsconfig` include; expect it NOT to compile yet.
→ Verify: files present with headers; `THIRD_PARTY.md` updated.

#### Milestone B2: Swap the SQLite driver (test-first)
1. Add `test/vendor-mnemopi/store.test.ts` (red): open a temp DB via the ported store, `remember` one fact, `recall` it back.
2. Replace `bun:sqlite` imports/usages with the chosen driver across the vendored files; adjust prepared-statement/API differences.
3. Run the test (green).
→ Verify: `store.test.ts` passes on Node (no Bun).

#### Milestone B3: Rewire pi-ai + neutralize natives
1. Replace `@oh-my-pi/pi-ai` imports with `@earendil-works/pi-ai` equivalents; where an API is missing, define a thin adapter in `src/vendor/mnemopi/adapters.ts`.
2. Put embeddings behind an `Embedder` interface with a no-op/default implementation; drop `@oh-my-pi/pi-natives`. Real embeddings become an optional injected impl.
3. Update `THIRD_PARTY.md` "changes" to describe the rewiring.
→ Verify: `npx tsc --noEmit` clean for `src/vendor/mnemopi/`; `store.test.ts` still passes.

#### Milestone B4: Expose as extension tools
1. In `src/memory.ts`, wrap the ported `Mnemopi` facade; instantiate a project-scoped DB under the pi agent dir (or `.pi/`).
2. In `src/index.ts`, register `remember` and `recall` tools (and optionally a `/recall` command) backed by it.
3. Add `test/memory.test.ts`: register → remember → recall round-trip through the tool layer.
→ Verify: `pi -e ./src/index.ts` exposes `remember`/`recall`; round-trip test passes.

## Affected Files
- New (Phase A): `plans/mnemopi-spike-notes.md`; edits to `THIRD_PARTY.md`, `docs/decisions.md`.
- New (Phase B): `src/vendor/mnemopi/**`, `src/vendor/mnemopi/adapters.ts`, `src/memory.ts`, `test/vendor-mnemopi/store.test.ts`, `test/memory.test.ts`; edits to `src/index.ts`, `tsconfig.json`, `THIRD_PARTY.md`.

## Dependencies
- SQLite driver: `node:sqlite` (builtin, newer Node) or `better-sqlite3` (native, proven) — decided in A2.
- Optional embeddings: a JS lib (e.g. `@xenova/transformers`) injected behind `Embedder`; not required for the first port.

## Rollback
- Phase B is purely additive (new files + two new tools). Revert = delete `src/vendor/mnemopi/`, `src/memory.ts`, the tool registrations, and the `THIRD_PARTY.md`/tsconfig edits. No shared state touched.

## Acceptance Criteria
- [ ] Phase A ends in a recorded go/no-go with an effort estimate and a driver choice.
- [ ] (If go) ported store runs on Node with no `bun:*` or `@oh-my-pi/*` imports.
- [ ] (If go) `remember`/`recall` work end-to-end; MIT headers preserved and source commit pinned in `THIRD_PARTY.md`.

## Tests
- Test type: Unit (store round-trip; tool round-trip).
- New: `test/vendor-mnemopi/store.test.ts`, `test/memory.test.ts`.

## Decisions Log
| Decision | Chosen | Alternatives Considered | Why |
|----------|--------|------------------------|-----|
| Spike before port | Yes — Phase A gates Phase B | Port directly | Coupling (bun:sqlite ×21, forked pi-ai, natives) is real; cheap to de-risk first |
| Embeddings in first port | Deferred behind an `Embedder` interface | Port ONNX/pi-natives now | Native embeddings are the heaviest coupling; memory works without semantic recall initially |
| SQLite driver | **Decide in A2** (`node:sqlite` vs `better-sqlite3`) | — | Must ship FTS5 (first-port recall is FTS5-only, since `vec0` comes from the runtime-loaded `sqlite-vec` extension, not the driver, and embeddings are deferred). `better-sqlite3` bundles FTS5; `node:sqlite` FTS5 depends on the Node build. |
| First-port recall degradation | FTS5 + importance only (dense/vec score = 0) | Full hybrid recall | `sqlite-vec` is a runtime-loaded native extension unavailable without embeddings; acceptable for the first port, stated explicitly in the go/no-go |
| Never import `@oh-my-pi/*` | Vendor + rewire to upstream | `npm install @oh-my-pi/pi-mnemopi` | Would drag omp's forked pi-ai + natives + Bun alongside upstream pi (see docs/decisions.md) |

## Review Log

### Review 1 — 2026-08-07
**Flaws found:** 3
**Changes made:**
- A1: replaced the narrow "remember/recall/stats/sleep" facade description with the real ~30-function export surface; added a step to enumerate the full 66-file/~19.7k-LoC tree and the remember/recall transitive import set — **Reason:** the plan's effort estimate and first-port scope rested on a facade summary that hides 95% of the code; A3 can't be sound without the real dependency graph.
- A1/A2: broadened the forked-dep enumeration from "pi-ai/pi-utils/pi-natives" to all four forked deps (added `@oh-my-pi/pi-catalog/hosts`, 2 call sites) and added a `Bun.` grep step covering core-path Bun-runtime APIs (`Bun.CryptoHasher` in `util/ids.ts` on the remember() path, `Bun.spawnSync` in `db.ts`) that the `bun:` grep misses — **Reason:** A2's "1:1 replacement mapping" claim would have been incomplete, and `util/ids` is a core-path Bun-ism that would surface as a compile error mid-port.
- A2/A3/Decisions: stated explicitly that `vec0` comes from the runtime-loaded `sqlite-vec` extension (not the driver), so first-port recall is FTS5 + importance only; made FTS5 a hard driver-selection requirement — **Reason:** the plan framed vector support as a driver-feature question, which is wrong; with embeddings deferred the dense/vec score is zero, and `node:sqlite` may not ship FTS5 depending on the Node build, which is a feasibility gate.
- A3: added an explicit first-port subsystem in/out decision (extraction, triples, annotations, episodic-graph, polyphonic-recall, veracity-consolidation) with a default minimal scope — **Reason:** "remember/recall work end-to-end" is ambiguous when recall transitively touches ~10 core subsystems.
**Still open:**
- The actual go/no-go effort estimate — **Reason not resolved:** that is the spike's output (A3), not something a plan review can set; the fixes ensure the spike has the real numbers to work from.
