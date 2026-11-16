# Plan: Compaction ladder (graduated, no-LLM "snip" tier first)

## Goal
Cut the total-token cost of long sessions by adding a graduated compaction
ladder, starting with the cheapest tier that needs **no LLM summarize call**:
elide stale tool-result messages in place when compaction is about to fire, so
many compactions resolve without a paid model round-trip. This is the
"snip" tier from Reasonix / snapcompact that `docs/research.md` flags as worth
stealing.

## Why now (and why this scope)
The eval (`plans/eval-benefits.md`) found total-token cost is pi-fleet's one
consistent **loss** (T2 child 2.4–3.7× more). The cost is dominated by the child
re-establishing its own context AND by bulky tool results accumulating. The
eval ran short `-p` sessions where compaction never triggered, so the ladder's
benefit is **not yet measured** — it targets the *long* interactive sessions
that are pi-fleet's actual use case (explore-then-act, multi-step). Shipping a
full ladder (LLM-summarize tier) blind, without a measured long-session
workload, violates "plan for delivery, not perfection." So: ship the cheap,
safe, no-LLM tier first; add the summarize tier only when a long-session
benchmark shows the snip tier is insufficient.

## Scope
- In scope: a `session_before_compact` handler that, before pi's default
  summarize compaction runs, **snips** old tool-result messages (replace their
  content with a short placeholder like `[snipped: read of <file>, N lines]`)
  past a configurable age/turn distance, then lets compaction re-evaluate. If
  snipping frees enough context, compaction resolves without an LLM call.
- Out of scope: the LLM-summarize tier (deferred behind a measured need), the
  `force` tier, fold-economics, provider-billing-aware accounting, applying
  compaction to the *child* session (the child is ephemeral and short; the
  parent is where long sessions live).

## Approach

### Milestone 1 — Snip handler on the parent session
1. Register a `session_before_compact` handler in `src/index.ts` that receives
   `SessionBeforeCompactEvent` (with `branchEntries`, `reason`, `signal`).
2. Implement a pure helper `snipOldToolResults(entries, opts): {entries, snipped}`
   in a new `src/compaction.ts` that replaces the content of toolResult entries
   older than `keepRecentTurns` with a placeholder, preserving the entry shape
   so pi can re-serialize the tree. Keep the most recent N turns intact (the
   "tail" the model still needs).
3. Return the snipped entries via the handler result so pi re-evaluates
   compaction without summarizing. If the handler can't free enough, return
   without a `compaction` result so pi falls back to its default summarize.
4. Unit-test `snipOldToolResults` on hand-built `SessionEntry[]` (pure, no
   provider).
→ Verify: `npm test` + `npm run check` green; a long interactive session
shows a `[snipped …]` placeholder and avoids a summarize turn when snipping
suffices.

### Milestone 2 — Measure on a long session
1. Build a long-session benchmark: a single interactive `pi` run that does
   ≥8 read/edit turns (enough to approach the compaction threshold), both with
   and without the snip handler. Capture total tokens + number of summarize
   turns.
2. Report the snip tier's effect in `docs/research.md`. If snipping alone is
   insufficient to avoid most summarizes, scope the LLM-summarize tier
   (Milestone 3); otherwise stop.
→ Verify: a results row showing summarize-turns-avoided and token delta.

### Milestone 3 (conditional) — LLM-summarize tier
Only if Milestone 2 shows the snip tier is insufficient: add a graduated
`compact` tier that calls the model to summarize the snipped tail, gated by a
threshold (e.g. snip frees < X% → summarize). Reuse pi's own `generateSummary`
helper (exported from `@earendil-works/pi-coding-agent`).

## Affected Files
- New: `src/compaction.ts` (`snipOldToolResults`), `test/compaction.test.ts`.
- Modify: `src/index.ts` (register the `session_before_compact` handler).
- Docs: `docs/research.md` (Milestone 2 results).

## Acceptance Criteria
- [ ] `snipOldToolResults` is pure, unit-tested, and `npm test` + `npm run check` pass.
- [ ] A `session_before_compact` handler snips old tool results and lets pi
      re-evaluate without summarizing when snipping suffices.
- [ ] A long-session benchmark shows summarize-turns-avoided (or documents that
      the snip tier is insufficient and Milestone 3 is needed).

## Decisions Log
| Decision | Chosen | Alternatives | Why |
|----------|--------|--------------|-----|
| Snip tier first, summarize tier deferred | no-LLM elision of old tool results | Full ladder (snip + summarize + force) up front | Eval didn't measure long-session benefit; shipping an LLM-summarize tier blind is unvalidated scope. Snip is safe, cheap, reversible, and the research.md already flagged it as the worth-stealing tier. |
| Parent session, not child | hook `session_before_compact` on the parent | compact the ephemeral child | Child runs are short (compaction never triggered in the eval); long sessions live in the parent. |
