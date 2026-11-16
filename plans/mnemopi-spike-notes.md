# mnemopi feasibility spike — notes (Phase A)

Source tree investigated: `~/Projects/open-sources/oh-my-pi/packages/mnemopi`
(`@oh-my-pi/pi-mnemopi` v17.2.10, MIT, author Can Boluk). All facts below were
verified directly against that tree on 2026-08-08.

---

## A1 — Surface map

### Public API (facade) — `src/index.ts` re-exports

`index.ts` re-exports ~30 functions from `core/memory.ts` plus four `core/*`
barrel modules:

- From `core/memory`: `addMemory`, `flushExtractions`, `forget`, `get`,
  `getBank`, `getContext`, `getDefaultInstance`, `getStats`, `Mnemopi` (class),
  `query`, `recall`, `recallEnhanced`, `remember`, `resetDefaultInstanceForTests`,
  `resetMemoryForTests`, `resetModuleStateForTests`, `saveMemory`, `scratchpadClear`,
  `scratchpadRead`, `scratchpadWrite`, `search`, `setBank`, `sleep`,
  `sleepAllSessions`, `storeMemory`, `update`.
- `configureRecallFeatures` + `RecallFeatureFlags` from `config`.
- `export * from "./core/beam/index"` (BeamMemory class + `initBeam` + beam types).
- `export * from "./core/embeddings"` (embed/embedQuery/available/providers/...).
- `export * from "./core/llm-backends"`.
- `export * from "./core/memory"` (the same facade fns again, via the core barrel).

Also exported via `package.json` `exports`: `./core`, `./core/beam`, `./beam`,
`./diagnose`, `./mcp`, `./cli`, and `./*` passthrough.

### Full source tree — 66 files / 19 657 LoC

Top files by LoC (the heavy core):

| LoC | File |
| --- | --- |
| 1225 | `core/beam/recall.ts` |
| 1132 | `core/beam/consolidate.ts` |
| 1083 | `core/beam/store.ts` |
| 970 | `mcp-tools.ts` |
| 831 | `core/beam/helpers.ts` |
| 708 | `core/episodic-graph.ts` |
| 680 | `core/memory.ts` (facade) |
| 586 | `core/embeddings.ts` |
| 567 | `core/shmr.ts` |
| 563 | `core/polyphonic-recall.ts` |
| 491 | `core/extraction.ts` |
| 484 | `core/patterns.ts` |
| 477 | `core/veracity-consolidation.ts` |
| 475 | `core/local-llm.ts` |
| 456 | `core/annotations.ts` |
| 452 | `core/triples.ts` |
| 426 | `core/beam/schema.ts` |
| 419 | `core/streaming.ts` |
| 407 | `core/typed-memory.ts` |
| 405 | `dr/recovery.ts` |
| 398 | `cli.ts` |
| 375 | `core/plugins.ts` |
| 373 | `config.ts` |
| 363 | `core/temporal-parser.ts` |
| 358 | `core/beam/index.ts` |
| 351 | `core/query-cache.ts` |
| 317 | `core/binary-vectors.ts` |
| 303 | `core/beam/types.ts` |
| 263 | `core/entities.ts` |
| 211 | `core/migrations/e6-triplestore-split.ts` |
| 197 | `core/synonyms.ts` |
| 193 | `core/extraction/diagnostics.ts` |
| 187 | `core/extraction/client.ts` (LLM) |
| 186 | `db.ts` |
| 174 | `diagnose.ts` |
| 172 | `core/fastembed-runtime.ts` |
| 165 | `util/regex.ts` |
| 160 | `core/chat-normalize.ts` |
| 157 | `types.ts`, `core/recall-diagnostics.ts` |
| 155 | `mcp-server.ts` |
| 142 | `core/aaak.ts` |
| 139 | `core/query-intent.ts` |
| 136 | `core/content-sanitizer.ts` |
| 133 | `core/banks.ts` |
| 130 | `core/runtime-options.ts` |
| 124 | `core/weibull.ts` |
| 101 | `core/mmr.ts`, `core/cost-log.ts` |
| 83 | `core/vector-index.ts` |
| 69 | `util/datetime.ts` |
| 65 | `util/env.ts` |
| 62 | `core/orchestrator.ts` |
| 54 | `core/llm-backends.ts` |
| 48 | `util/lru.ts` |
| 39 | `core/index.ts`, `core/fastembed-model-cache.ts` |
| 33 | `index.ts` |
| 31 | `core/extraction/prompts.ts` |
| 30 | `core/token-counter.ts` |
| 23 | `core/vector-math.ts` |
| 19 | `util/ids.ts` |
| 1 each | `migrations/index.ts`, `migrations/e6-triplestore-split.ts`, `dr/index.ts`, `core/migrations/index.ts` |

`core/` subsystems: extraction pipeline, triples, annotations, episodic-graph,
polyphonic-recall, veracity-consolidation, query-intent, query-cache, MMR/SHMR
reranking, vector-index, binary-vectors, fastembed-runtime, local-llm,
llm-backends, orchestrator, plugins, streaming, cost-log, synonyms,
temporal-parser, weibull, entities, patterns, chat-normalize, content-sanitizer,
aaak, token-counter, recall-diagnostics, typed-memory, banks, runtime-options.

### remember() transitive imports (from `core/beam/store.ts`)

`db.ts` (openDatabase/transaction/closeQuietly) · `util/ids.ts` (generateId →
**Bun.CryptoHasher**) · `util/datetime.ts` (toUtcIso, pure JS) · `config.ts`
(weights, env, **hostMatchesUrl**) · `core/embeddings.ts`
(currentEmbeddingModel, embeddingsDisabled — **STUB**) · `core/beam/helpers.ts`
(scheduleEmbedding, vecAvailable, vecInsert, encodeVector, decodeVector,
tableExists) · `core/beam/types.ts` · `core/beam/consolidate.ts`
(storeExtractedFactCategories — one leaf fn) · `core/extraction.ts`
(countExtractedFactCategories, extractFactCategoriesSafe — heuristic, **only
called when `extract:true`**; default remember does NOT extract) ·
`core/runtime-options.ts` (AsyncLocalStorage scope; type-only `@oh-my-pi/pi-ai`)
· `core/episodic-graph.ts` (instantiated by BeamMemory ctor) ·
`core/annotations.ts` (instantiated by BeamMemory ctor).

### recall() transitive imports (from `core/beam/recall.ts`)

`config.ts` (normalizedRecallWeights, temporalHalflifeHours) ·
`core/embeddings.ts` (embedQuery — **returns null when disabled; STUB**) ·
`core/mmr.ts` (mmrRerank — **has a pure-JS path; drop pi-natives**) ·
`core/query-intent.ts` (classifyIntent, adjustWeights, pure JS) ·
`core/synonyms.ts` (getSynonyms, normalizeQuery, STOP_WORDS, pure JS) ·
`core/temporal-parser.ts` (extractTemporal, pure JS) · `core/vector-math.ts`
(cosineSimilarity, pure JS) · `core/beam/helpers.ts` (tableExists, query helpers)
· `core/beam/types.ts`.

### Forked-dep call sites — all four (not three)

| Forked dep | Call sites | Used for |
| --- | --- | --- |
| `@oh-my-pi/pi-ai` | `core/runtime-options.ts` (type `Api,ApiKey,Model`), `core/memory.ts` (type `Api,ApiKey,Model`), `core/embeddings.ts` (`ApiKey,getOpenRouterHeaders,withAuth` + `ProviderHttpError`), `core/local-llm.ts` (chat completion types + error), `core/llm-backends.ts` (type `FetchImpl`), `core/extraction/client.ts` (`ApiKey,FetchImpl,withAuth` + error) | Type aliases on the facade; **auth/fetch/error only in deferred embeddings/LLM/extraction modules** |
| `@oh-my-pi/pi-utils` | `core/beam/helpers.ts` (`logger`), `core/beam/store.ts` (`logger`), `core/shmr.ts` (`logger`), `core/embeddings.ts` (`$env,$flag,extractHttpStatusFromError,fetchWithRetry,getFastembedCacheDir,logger` + `LRUCache` from `/lru`), `core/fastembed-runtime.ts` (utils) | `logger` on 3 core-path files; everything else is in deferred embeddings/fastembed |
| `@oh-my-pi/pi-natives` | `core/mmr.ts` (`mmrRerankIndices`), `core/shmr.ts` (`cosineSimilarityPairs`), `core/vector-index.ts` (`vectorIndexTopK`) | Native perf kernels; **every one has a pure-JS fallback in the same file** |
| `@oh-my-pi/pi-catalog/hosts` | `core/embeddings.ts` (`hostMatchesUrl` — 3 uses), `config.ts` (`hostMatchesUrl` — 2 uses) | Leaf URL-substring matcher; 5 total call sites, all gating "is this baseUrl openrouter?" |

### `bun:sqlite` — 21 call sites

All use `Database` (type) and/or `SQLQueryBindings`; only `db.ts` and
`core/triples.ts` import the **value** `Database` (constructor). The rest are
`import type`. SQLite features required:

- **Prepared statements** (`db.prepare`, `.run`, `.get`, `.all`) — everywhere.
- **FTS5** — 3 virtual tables: `fts_episodes`, `fts_working` (`beam/schema.ts`),
  `fts_facts` (same file). Hybrid recall is FTS5 + vector; **with embeddings
  deferred, recall degrades to FTS5 + importance only**.
- **JSON1** — light use (~3 `json_extract`-ish sites); `memory_embeddings` stores
  vectors as JSON text.
- **`vec0` virtual tables** — **NOT created in schema**. The `vec_episodes` table
  comes from runtime `loadExtension('sqlite-vec')`; `vecAvailable(db)` checks
  `tableExists(db,"vec_episodes")` and returns false when the extension is not
  loaded. `vecSearch` returns `[]`, `vecInsert` is skipped, recall's dense/vec
  score is 0. So **vector search is unavailable in the first port regardless of
  driver**, and `sqlite-vec` is not a driver feature.

### `Bun.` runtime APIs (not caught by `bun:` grep)

| API | File | Core path? | Replacement |
| --- | --- | --- | --- |
| `Bun.CryptoHasher` | `util/ids.ts` (`sha256Hex16` on the `remember()` id path) | **YES — core** | `node:crypto.createHash("sha256")` |
| `Bun.spawnSync` | `db.ts` (`getconf PAGE_SIZE` detection) | core, but **dispensable** | `child_process.spawnSync`, or drop page-size auto-detection for first port |
| `Bun.file`/`Bun.write`/`Bun.Glob` | `core/fastembed-model-cache.ts`, `core/fastembed-runtime.ts` | **NO — deferred** (embeddings) | goes away with the deferred fastembed modules |
| `Bun.stdin/stdout/argv` | `mcp-server.ts`, `cli.ts` | **NO — not ported** | MCP server / CLI out of scope |
| `Bun.version` | `diagnose.ts` | **NO — not ported** | diagnose out of scope |

---

## A2 — Replacement map (1:1)

### Forked deps

| Forked import | Upstream / Node replacement | Gap? |
| --- | --- | --- |
| `@oh-my-pi/pi-ai` type `Api`, `Model` | `@earendil-works/pi-ai` exports `Api` (`types.ts:29`) and `Model<TApi>` (`types.ts:785`) | None (type-only) |
| `@oh-my-pi/pi-ai` type `ApiKey` | Define local `type ApiKey = string` in `adapters.ts` (first port wires no LLM/embedding API keys) | Local alias; omp's `ApiKey = string \| ApiKeyResolver` shape not needed without embeddings/LLM |
| `@oh-my-pi/pi-ai` `withAuth`, `getOpenRouterHeaders`, `ProviderHttpError`, `FetchImpl` | Define thin stubs in `adapters.ts` (only used by deferred embeddings/LLM/extraction) | Stubs return disabled/null; real impl deferred with embeddings |
| `@oh-my-pi/pi-utils` `logger` | Tiny shim in `adapters.ts` (`{ debug, info, warn, error }` → `console.*` or no-op) | None |
| `@oh-my-pi/pi-utils` `LRUCache` | mnemopi already ships its own `util/lru.ts` (`LruCache`) — use that, or copy the 48-LoC `LruCache` from omp `utils/src/lru.ts` | None |
| `@oh-my-pi/pi-utils` `$env,$flag,fetchWithRetry,extractHttpStatusFromError,getFastembedCacheDir` | Only used in `core/embeddings.ts` + `fastembed-runtime.ts` (deferred) | Gone with deferred modules |
| `@oh-my-pi/pi-natives` `mmrRerankIndices` | `core/mmr.ts` already has a pure-JS MMR loop (the native call is an optimized fast path guarded by `similarityFn === jaccardSimilarity`); drop the native branch | None — JS path is the fallback already |
| `@oh-my-pi/pi-natives` `vectorIndexTopK` | `core/vector-index.ts` has `buildExactVectorIndex`/`searchExactVectorIndex` with a JS scoring path; drop the native fast path | None (module only used by SHMR/consolidation, which are dropped first port) |
| `@oh-my-pi/pi-natives` `cosineSimilarityPairs` | `core/shmr.ts` uses it for batch pair scoring; SHMR is **dropped** first port (veracity consolidation needs embeddings) | None — SHMR out of scope |
| `@oh-my-pi/pi-catalog/hosts` `hostMatchesUrl` | Inline a 6-line helper in `adapters.ts`: case-insensitive substring match for `"openrouter.ai"` against `baseUrl`. Only host used by mnemopi is `"openrouter"` | None — leaf utility |

### Bun runtime APIs

| Bun API | Replacement |
| --- | --- |
| `Bun.CryptoHasher("sha256").update(v).digest("hex")` | `node:crypto.createHash("sha256").update(v).digest("hex")` (identical API) |
| `Bun.spawnSync(["getconf","PAGE_SIZE"])` in `db.ts` | Drop page-size auto-detection for the first port (`MNEMOPI_DB_PAGE_SIZE=os` falls back to SQLite default); or `child_process.spawnSync` if kept |
| `Bun.file`/`write`/`Glob` | Gone with deferred fastembed |
| `Bun.stdin/stdout/argv/version` | Not ported (MCP/CLI/diagnose out of scope) |

### SQLite driver — `better-sqlite3` (chosen)

Requirement: must ship **FTS5** (first-port recall is FTS5-only). Verified
empirically on 2026-08-08:

- **`node:sqlite`** (Node v23.11.0, experimental): `CREATE VIRTUAL TABLE … USING
  fts5` → **`no such module: fts5`**. FTS5 is not compiled into this Node build.
  Rejected — FTS5 is a hard requirement.
- **`better-sqlite3`** v13.0.3: FTS5 works (`MATCH` query returns rows);
  `loadExtension` present (so `sqlite-vec` can be loaded later when embeddings
  arrive). Synchronous API, prepared statements, transactions — all match
  mnemopi's usage shape. Bundles its own SQLite (FTS5 enabled by default).

API mapping (`bun:sqlite` → `better-sqlite3`):

| `bun:sqlite` | `better-sqlite3` |
| --- | --- |
| `import { Database } from "bun:sqlite"` | `import Database from "better-sqlite3"` |
| `new Database(path, { create, readwrite, strict })` | `new Database(path)` (create/readwrite default; `strict` has no equivalent — drop) |
| `db.exec(sql)` | `db.exec(sql)` |
| `db.query(sql).all(...params)` / `.get(...)` / `.run(...)` | `db.prepare(sql).all(...params)` / `.get(...)` / `.run(...)` |
| `type SQLQueryBindings` | `import type { BindingOrRecord }` or local `type SqlValue = string\|number\|bigint\|Uint8Array\|null` |
| `db.loadExtension(path)` | `db.loadExtension(path)` |
| `using statement = db.prepare(sql)` | `db.prepare(sql)` (no `using`; statement is reusable) |

### First-port recall degradation — stated explicitly

With embeddings deferred (no `Embedder` wired) and `sqlite-vec` not loaded:
`embedQuery()` → `null` → `queryEmbedding` is `null` → `vectorSimilarities()`
returns an empty map → every candidate's `dense`/vec score is `0`. Recall ranking
= `ftsWeight * ftsScore + importanceWeight * importanceScore` (the vec term is
zero). `normalizedRecallWeights` still normalizes the three weights, so the FTS
and importance terms carry the vec share. This is acceptable for the first port
and is the documented degradation.

---

## A3 — Go/no-go

### Effort estimate (from the real 66-file / 19.7k-LoC tree)

- **Files to vendor (minimal core path):** ~28 files
  (`db.ts`, `util/ids.ts`, `util/datetime.ts`, `util/env.ts`, `util/lru.ts`,
  `config.ts`, `types.ts`, `core/memory.ts`, `core/banks.ts`,
  `core/runtime-options.ts`, `core/annotations.ts`, `core/episodic-graph.ts`,
  `core/mmr.ts`, `core/query-intent.ts`, `core/synonyms.ts`,
  `core/temporal-parser.ts`, `core/vector-math.ts`, `core/extraction.ts`
  (heuristic fact-category fns only), `core/beam/index.ts` (trimmed),
  `core/beam/store.ts`, `core/beam/recall.ts`, `core/beam/schema.ts`,
  `core/beam/helpers.ts`, `core/beam/types.ts`, `core/beam/consolidate.ts`
  (only the `storeExtractedFactCategories` leaf — or inline it and drop the
  file)).
- **LoC vendored:** ~7–9k of the 19.7k (the rest is deferred/dropped subsystems).
- **New code:** ~600 LoC (`src/vendor/mnemopi/adapters.ts`,
  `src/vendor/mnemopi/embeddings-stub.ts`, `src/memory.ts`, tool registrations in
  `src/index.ts`, two test files, tsconfig/`THIRD_PARTY.md` edits).
- **Native-dep risk:** LOW. `better-sqlite3` is proven; FTS5 confirmed live.
  `pi-natives` dropped (JS fallbacks exist in-file). Bun APIs replaced with
  `node:crypto` / dropped.
- **Forked-dep risk:** LOW. 4 deps, all 1:1 mapped; core-path uses are type-only
  (`Api`/`Model`) or a leaf URL matcher.
- **Effort:** ~2–3 focused days for B1–B4.

### First-port subsystem in/out

**IN (core path, vendored):**
- `beam/store` (remember), `beam/recall` (FTS5+importance), `beam/schema`
  (FTS5 tables + triggers), `beam/helpers` (tableExists, encode/decodeVector,
  scheduleEmbedding no-op, vecAvailable→false), `beam/types`, `beam/index`
  (BeamMemory class **trimmed** to remember/recall/getContext/get/
  getWorkingStats/invalidate/updateWorking/forgetWorking/scratchpad*/close/
  flushExtractions — drop sleep/consolidate/extract/memoria/import-export
  methods and their `consolidate.ts` imports).
- `db.ts` (openDatabase/transaction/closeQuietly, better-sqlite3).
- `util/ids` (node:crypto), `util/datetime`, `util/env`, `util/lru`.
- `config.ts` (env weights + inlined `hostMatchesUrl`).
- `core/memory.ts` (Mnemopi facade, trimmed to remember/recall/getContext/
  getStats/get/forget/update/scratchpad*/close — drop sleep/sleepAllSessions
  or keep as no-op stubs).
- `core/banks`, `core/runtime-options` (AsyncLocalStorage scope; type-only
  pi-ai → adapter).
- `core/annotations`, `core/episodic-graph` (instantiated by BeamMemory ctor;
  pure SQL+JS, no forked deps).
- `core/mmr` (JS path), `core/query-intent`, `core/synonyms`,
  `core/temporal-parser`, `core/vector-math` (pure JS recall helpers).
- `core/extraction.ts` — **only** `countExtractedFactCategories` +
  `extractFactCategoriesSafe` (heuristic, non-LLM). The LLM extraction pipeline
  (`extraction/client.ts`, `extraction/prompts.ts`, `extraction/diagnostics.ts`)
  is OUT.

**STUB (deferred behind an `Embedder` interface, no-op default):**
- `core/embeddings.ts` — `embedQuery→null`, `embed→null`, `embeddingsDisabled→true`,
  `available→false`, `currentEmbeddingModel→"none"`. Real embeddings become an
  optional injected `Embedder` impl.
- `core/fastembed-runtime.ts`, `core/fastembed-model-cache.ts` — not vendored.

**DROP (not on remember/recall path, heavy, or LLM/embedding-coupled):**
- `core/consolidate` (sleep/episodic consolidation — LLM-coupled), `core/shmr`
  (veracity harmonization — needs embeddings), `core/polyphonic-recall`,
  `core/veracity-consolidation`, `core/query-cache`, `core/streaming`,
  `core/cost-log`, `core/binary-vectors`, `core/vector-index` (only SHMR uses it),
  `core/patterns`, `core/entities` (extraction-based), `core/weibull`,
  `core/aaak`, `core/chat-normalize`, `core/content-sanitizer`, `core/orchestrator`,
  `core/plugins`, `core/typed-memory`, `core/recall-diagnostics`,
  `core/token-counter`, `core/local-llm`, `core/llm-backends`,
  `core/extraction/client.ts` + prompts + diagnostics, `core/triples` (KG store,
  not on remember/recall path), `core/migrations/e6-triplestore-split` (triplestore
  migration — drop with triples; `autoMigrateAnnotations` call removed from the
  trimmed BeamMemory ctor).
- `mcp-tools.ts`, `mcp-server.ts`, `cli.ts`, `diagnose.ts`, `dr/recovery.ts`,
  `bench/` — out of scope (MCP server, CLI, diagnostics, disaster-recovery).

### Verdict: **GO**

The coupling is real but bounded: every forked-dep call site has a 1:1
replacement; `pi-natives` is pure perf optimization with in-file JS fallbacks;
core-path Bun APIs are one `node:crypto` swap + one dispensable page-size probe;
FTS5 is available via `better-sqlite3` (and *not* via `node:sqlite` on this Node
build, which settles the driver question). The FTS5-only recall degradation is
acceptable and explicit. The minimal subsystem scope is well-defined (~28 files,
~7–9k LoC of the 19.7k).

Driver: **`better-sqlite3`** (FTS5 confirmed live; `node:sqlite` rejected — no
FTS5 on Node v23.11.0).