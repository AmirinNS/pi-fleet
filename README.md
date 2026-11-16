# pi-fleet

Cache-aware **subagents, planner/executor, and context-maintenance** for the
[pi](https://pi.dev) coding agent — packaged as a pi **extension**, not a fork.

The ideas are borrowed from [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix)'s
DeepSeek tuning, but re-implemented **model-agnostic**: the orchestration works on
any provider pi supports (DeepSeek, GLM, Kimi, Qwen, Claude, GPT…), and the
provider-specific cache behaviour lives behind a small per-provider adapter.

## Why an extension, not a fork

pi exposes a first-class extension SDK (`pi.registerTool`, `pi.registerCommand`,
lifecycle events, and the embeddable `Agent` runtime from
`@earendil-works/pi-agent-core`). Everything here plugs into those seams:

| Feature | pi seam |
| --- | --- |
| Subagents (`task` / `/reviewer`) | `registerTool` + `registerCommand`; handler spawns an isolated `Agent` |
| Planner / executor split | two `Agent`s, different `getModel()`, **distinct stable `sessionId`s** |
| Guardian (tool-approval reviewer) | `pi.on("tool_call")` → read-only child `Agent` verdict |
| Compaction ladder (snip-before-summarize) | `pi.on("session_before_compact")` |
| Cache-hit telemetry | `pi.on("after_provider_response")` |

Drop the built bundle into `~/.pi/agent/extensions/` (global) or
`.pi/extensions/` (project) and `/reload`.

## Model-agnostic by design

The **features** (subagents, planner/executor, guardian, compaction) are pure
orchestration — they are indifferent to the model. What differs per provider is
only the **prefix-cache mechanism**, so that is the one thing isolated in
`src/providers.ts`:

| Provider | Prefix/context cache | What we do |
| --- | --- | --- |
| DeepSeek | automatic server-side prefix cache | keep prefix byte-stable; stable `sessionId` for node affinity |
| GLM (z.ai / Zhipu) | automatic context cache | same; also **preserve `reasoning_content`** across turns |
| Kimi (Moonshot) | context cache | same; honour K-series assistant-message replay |
| Anthropic / OpenAI | explicit `cache_control` breakpoints | stable prefix + place breakpoints |
| unknown | best-effort | stable prefix + stable `sessionId` only |

If a provider isn't recognised, nothing breaks — it just falls back to the
best-effort strategy and every orchestration feature still works.

## Prior art & real differentiation

Both **OpenCode** and **oh-my-pi** already ship subagents *and* compaction; oh-my-pi
also ships `snapcompact` (no-LLM, vision-frame, provider-billing-aware compaction)
and `mnemopi` (SQLite memory). Upstream **pi** ships none of these — which is why
the subagent runtime is worth adding to pi, but also why **"subagents exist" is
not the differentiator.** Three other agents prove subagents are table-stakes.

**pi-fleet's core is the one corner none of pi / OpenCode / oh-my-pi covers
portably:** Reasonix's **cache-stable planner/executor split** (two models in
separate, affinity-pinned sessions) plus the **model-agnostic per-provider cache
strategy**. The subagent runtime, compaction ladder, and guardian are substrate
and supporting features around that core — not the pitch.

### oh-my-pi is an idea mine, not a dependency

oh-my-pi is an MIT fork of pi that keeps pi's extension API, but its feature
packages hard-couple to omp's *forked* `@oh-my-pi/pi-ai`, native `pi-natives`,
and Bun runtime APIs. We never `npm install @oh-my-pi/*` (it would drag a
parallel forked stack alongside upstream pi). Instead we **steal ideas freely**
and **vendor MIT leaf code selectively**, rewiring deps to upstream — see
[`THIRD_PARTY.md`](THIRD_PARTY.md).

## Status

**Phase 1 scaffold — API verified against pi source (`open-sources/pi`).** The
`task` tool + `/reviewer` command are wired to an isolated ephemeral child via
pi's `createAgentSession()` SDK. `npm run check` needs the pi packages installed
(they are `peerDependencies`). Next: planner/executor split, then the compaction
ladder.
