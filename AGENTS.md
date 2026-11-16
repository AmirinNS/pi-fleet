# AGENTS.md — pi-fleet

Guidance for AI agents working in this project. `CLAUDE.md` symlinks here.

## New here? Start with `docs/research.md`

That is the onboarding/context log — why this project exists, the four-repo
investigation behind it, the verified pi API facts, and the current state. Read it
after this file. Decisions are in `docs/decisions.md`; plans in `plans/`.

## What this is

A **pi extension** (TypeScript) that adds cache-aware subagents, a
planner/executor split, a guardian tool-approval reviewer, and a
compaction ladder to the [pi](https://pi.dev) coding agent. Inspired by
DeepSeek-Reasonix, but **model-agnostic**. Core differentiator: the cache-stable
planner/executor split (see `docs/research.md`).

This project **opts out** of the workspace Flask/Mongo/Bootstrap house style. It
is a Node/TypeScript library that targets pi's extension API — treat it like the
other TS opt-out projects (FCPO, underground-tycoon).

## Non-negotiable design rules

1. **No fork of pi.** Everything integrates through the public extension SDK
   (`@earendil-works/pi-coding-agent`) and the embeddable runtime
   (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`). If a feature seems
   to need a pi source change, stop and reconsider — it almost never does.
2. **Features are model-agnostic; only cache behaviour is provider-specific.**
   Orchestration (subagents, planner/executor, guardian, compaction) must never
   branch on the model. All provider-specific logic lives in `src/providers.ts`
   behind one `cacheStrategyFor(provider)` seam. An unknown provider must
   degrade to best-effort, never error.
3. **Prefix stability is the shared invariant.** Whatever the provider, don't
   mutate a session's system-prompt prefix mid-run; ride the turn tail. Give each
   long-lived child a **distinct, stable `sessionId`** (it becomes the provider
   session-affinity key).
4. **Subagents return the final answer only** — never leak the child's working
   context back into the parent thread. That isolation is both the feature and a
   context/cache win.

## Key pi API facts (verified against pi source)

- Extension entry: `export default function (pi: ExtensionAPI) {}`; placed in
  `~/.pi/agent/extensions/` or `.pi/extensions/`, hot-reload via `/reload`.
- `new Agent({ initialState: { systemPrompt, tools, messages, model }, getApiKey,
  sessionId, streamFn })` from `pi-agent-core`; drive with `agent.prompt(input)`,
  collect the final assistant message via `agent.subscribe` on `agent_end`.
- `sessionId` on the Agent flows to provider session-affinity headers
  (`x-session-affinity`, `session_id`) — this is the cache-node routing key.
- `getModel(provider, modelId)` from `pi-ai`; pi already registers DeepSeek, GLM
  (`zai.glm-4.7`), and Kimi (`moonshot.kimi-k2-thinking`, `moonshotai.kimi-k2.5`).
- Reuse real tools: `createReadOnlyTools(cwd)` / `createCodingTools(cwd)` from
  `@earendil-works/pi-coding-agent`.

## Seams — resolved against pi source

All three original `// VERIFY:` items are now settled by using the SDK instead of
a raw `Agent`:

- **Model / cwd / auth** — read `ctx.model` and `ctx.cwd` from `ExtensionContext`;
  `createAgentSession()` + `ModelRuntime` handle credential resolution, so no
  manual `getApiKey` is needed.
- **Tools** — pass built-in tool *names* (`["read","grep",…]`) to
  `createAgentSession({ tools })`; no `Tool`↔`AgentTool` bridge required.
- **Final answer** — after `session.prompt()` resolves, read `session.messages`
  and take the last assistant text (`extractFinalText`).
- **Custom child prompt** — `DefaultResourceLoader({ systemPromptOverride })`,
  built exactly the way `createAgentSession()` builds its own default loader
  (needs `cwd` + `agentDir` from `getAgentDir()` + a `SettingsManager`).

Remaining TODOs (not blockers): honour `profile.model` overrides (resolve
`{provider,modelId}` via `ctx.modelRegistry`); give long-lived children a stable
`sessionId` for cross-call cache affinity.

> Note: `npm run check` requires the three pi packages present in
> `node_modules` (they are `peerDependencies`). The API surface here was verified
> directly against the pi source tree at `open-sources/pi`.

Log non-trivial choices with the `log-decision` skill into `docs/decisions.md`.
