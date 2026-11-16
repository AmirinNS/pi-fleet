# Third-party / vendored code

pi-fleet builds only on upstream pi packages (`@earendil-works/pi-*`). Any code
adapted from another project is **vendored** under `src/vendor/<name>/` — never
added as an `@oh-my-pi/*` (or other fork) runtime dependency — so we don't pull a
parallel forked stack alongside upstream pi.

## Vendoring policy (MIT-clean)

When adapting code from an MIT project:

1. Copy the specific source files into `src/vendor/<name>/` and **keep the
   original MIT header + copyright** on each file.
2. Add a row to the table below: source repo, the exact upstream **commit** you
   copied from, and what was changed.
3. Rewire the leaf dependencies to upstream/Node equivalents:
   - `@oh-my-pi/pi-ai` → `@earendil-works/pi-ai`
   - `bun:sqlite` → `node:sqlite` (or `better-sqlite3`)
   - `@oh-my-pi/pi-natives` (native embeddings/rasterization) → drop or replace
     with a JS library.
4. Prefer stealing the **idea** over the **code** when the coupling tax (native
   modules, runtime-specific APIs) outweighs the port.

## Vendored modules

| Module | Source | Upstream commit | License | Changes |
| --- | --- | --- | --- | --- |
| mnemopi (subset) | `can1357/oh-my-pi` `packages/mnemopi/src` | `3a8591a8af5b6d200088d12ca75a5517cb064fa8` | MIT | First-port subset (~28 files of 66) — beam store/recall/schema/helpers/types, db, util/ids/datetime/env/lru/regex, config, types, memory facade, banks, runtime-options, annotations, episodic-graph, mmr, query-intent, synonyms, temporal-parser, vector-math, extraction (heuristic fns). **Driver:** `bun:sqlite` → `better-sqlite3` via a compat `Database`/`Statement` wrapper in `db.ts` (FTS5 confirmed; `sqlite-vec`/`vec0` not loaded → dense/vec score = 0, recall is FTS5 + importance only). **Forked deps rewired:** `@oh-my-pi/pi-ai` types → `adapters.ts` (re-exports upstream `@earendil-works/pi-ai` `Api`/`Model` + local `ApiKey`); `@oh-my-pi/pi-utils` `logger` → `adapters.ts` shim; `@oh-my-pi/pi-catalog/hosts` `hostMatchesUrl` → `adapters.ts` inline substring matcher; `@oh-my-pi/pi-natives` dropped (in-file JS fallbacks: `mmr.ts` native branch removed). **Bun runtime:** `Bun.CryptoHasher` → `node:crypto.createHash`; `Bun.spawnSync` page-size probe dropped. **Deferred (stubs):** embeddings (no-op `Embedder`), fastembed, local-llm, llm-backends, extraction/diagnostics, consolidate (sleep/episodic/veracity), binary-vectors, vector-index, migrations/e6-triplestore-split. **Dropped:** shmr, polyphonic-recall, veracity-consolidation, query-cache, streaming, cost-log, patterns, entities, weibull, aaak, chat-normalize, content-sanitizer, orchestrator, plugins, typed-memory, recall-diagnostics, token-counter, triples, mcp-tools, mcp-server, cli, diagnose, dr/recovery. Exposed as `remember`/`recall` tools via `src/memory.ts`. |

## Candidates evaluated (not vendored)

| Candidate | Source | Verdict |
| --- | --- | --- |
| snapcompact | `can1357/oh-my-pi` `packages/snapcompact` (MIT) | **Steal the idea, not the code.** Provider-billing-aware, no-LLM compaction is the valuable insight; the native (`pi-natives`) rasterization makes a code port heavy. Reimplement rendering in JS if/when needed. |
| mnemopi | `can1357/oh-my-pi` `packages/mnemopi` (MIT) | **GO — vendoring a minimal subset.** Phase A spike (`plans/mnemopi-spike-notes.md`) confirmed portability: `better-sqlite3` ships FTS5 (Node v23.11.0 `node:sqlite` does not); `pi-natives` dropped (JS fallbacks exist); core-path Bun = one `node:crypto` swap. First port = beam store + FTS5 recall + ids (~28 files, ~7–9k LoC of 19.7k); embeddings/LLM/extraction/SHMR/consolidation/triples/MCP/CLI dropped or stubbed behind an `Embedder` interface. Recall degrades to FTS5 + importance only (dense/vec score = 0). |
