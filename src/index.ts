/**
 * pi-fleet extension entry point.
 *
 * Phase 1: the `task` tool + `/reviewer` command backed by the isolated
 * subagent runtime.
 * Phase 2: the `plan` tool + `/plan` command backed by the cache-stable
 * planner/executor coordinator.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { loadProfile, profileNames } from "./profiles.ts";
import { runSubagent } from "./subagent.ts";
import { runPlanExecute } from "./coordinator.ts";
import { rememberFact, recallFacts } from "./memory.ts";

const TaskParams = Type.Object({
	profile: Type.String({ description: "Subagent profile name." }),
	prompt: Type.String({ description: "The task for the subagent." }),
});

const PlanParams = Type.Object({
	task: Type.String({ description: "The task to plan and execute." }),
});

const RememberParams = Type.Object({
	content: Type.String({ description: "The fact or observation to persist in project memory." }),
	importance: Type.Optional(Type.Number({ description: "0–1 salience; default 0.5.", minimum: 0, maximum: 1 })),
	source: Type.Optional(Type.String({ description: "Origin label; default 'agent'." })),
});

const RecallParams = Type.Object({
	query: Type.String({ description: "Natural-language query to search persisted memory." }),
	topK: Type.Optional(Type.Number({ description: "Max results; default 5.", minimum: 1, maximum: 50 })),
});

/** Format a child usage aggregate for human-readable output. */
function formatUsage(u?: Usage): string {
	if (!u) return "child usage: n/a";
	return `child usage: in=${u.input} out=${u.output} cacheRead=${u.cacheRead} cacheWrite=${u.cacheWrite} cost=$${u.cost.total.toFixed(4)}`;
}

/** Render a CoordinatorResult into a single text string for tool/command output. */
function describePlanResult(
	res: Awaited<ReturnType<typeof runPlanExecute>>,
): string {
	const plannerLine = formatUsage(res.plannerUsage);
	switch (res.status) {
		case "no_changes":
			return `[no_changes] The planner found nothing to do.\n\n${res.plan}\n\n${plannerLine}`;
		case "needs_approval":
			return `[needs_approval] Plan prepared; awaiting approval before execution.\n\n${res.plan}\n\n${plannerLine}`;
		case "needs_input": {
			const opts = res.ask.options.length ? `\nOptions: ${res.ask.options.join(", ")}` : "";
			return `[needs_input] ${res.ask.question}${opts}\n\n${res.plan}\n\n${plannerLine}`;
		}
		case "executed":
			return `[executed] Plan:\n${res.plan}\n\n---\nExecutor result:\n${res.result.answer}\n\n${plannerLine}\n${formatUsage(res.executorUsage)}`;
	}
}

export default function (pi: ExtensionAPI) {
	// LLM-callable: run an isolated subagent, get back only its final answer.
	pi.registerTool({
		name: "task",
		label: "Subagent",
		description:
			"Run an isolated subagent for focused work and return only its final answer. " +
			"Best for exploration-heavy or multi-step tasks where intermediate reads/tool results should stay out of the parent thread; " +
			"do NOT use for trivial one-shot edits — do those inline. " +
			"Available profiles: " + profileNames().join(", ") + ".",
		parameters: TaskParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const profile = loadProfile(params.profile);
			const result = await runSubagent({
				profile,
				prompt: params.prompt,
				cwd: ctx.cwd,
				// TODO: honour profile.model override (resolve {provider,modelId}
				// against ctx.modelRegistry) — for now inherit the parent's model.
				model: ctx.model,
				signal,
			});
			return {
				content: [{ type: "text", text: result.answer }],
				details: { profile: profile.name, provider: result.provider, usage: result.usage },
			};
		},
	});

	// LLM-callable: run the cache-stable planner/executor pipeline. Fail-closed
	// (no interactive approver), so [planner_requires_approval] returns
	// `needs_approval` to the model rather than executing side effects.
	pi.registerTool({
		name: "plan",
		label: "Plan & execute",
		description:
			"Plan a task with a read-only planner subagent, then (if the plan is approved or needs no approval) " +
			"execute it with an executor subagent. Use for multi-step changes where reading before editing avoids rework; " +
			"for trivial one-shot edits, do them inline instead. Returns the plan and the executor result, or a gate status.",
		parameters: PlanParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const res = await runPlanExecute({
				task: params.task,
				cwd: ctx.cwd,
				plannerModel: ctx.model,
				executorModel: ctx.model,
				signal,
			});
			return {
				content: [{ type: "text", text: describePlanResult(res) }],
				details: {
					status: res.status,
					plannerUsage: res.plannerUsage,
					executorUsage: res.status === "executed" ? res.executorUsage : undefined,
				},
			};
		},
	});

	// Human-callable: `/plan refactor the auth helper`
	pi.registerCommand("plan", {
		description: "Plan a task with a read-only planner, then execute it after approval.",
		handler: async (argsText, ctx) => {
			const task = argsText.trim();
			if (!task) {
				ctx.ui.notify("Usage: /plan <task description>", "warning");
				return;
			}

			const res = await runPlanExecute({
				task,
				cwd: ctx.cwd,
				plannerModel: ctx.model,
				executorModel: ctx.model,
				approve: (plan) => ctx.ui.confirm("Execute plan?", plan),
				signal: ctx.signal,
			});

			if (res.status === "needs_input") {
				const opts = res.ask.options.length ? res.ask.options : undefined;
				let answer: string | undefined;
				if (opts) {
					answer = await ctx.ui.select(res.ask.question, opts);
				} else {
					answer = await ctx.ui.input(res.ask.question);
				}
				ctx.ui.notify(
					answer
						? `Planner asked: ${res.ask.question}\nAnswer: ${answer}`
						: "Planner question was dismissed.",
					"info",
				);
				return;
			}

			ctx.ui.notify(describePlanResult(res), "info");
		},
	});

	// Human-callable convenience: `/reviewer review the current diff`
	pi.registerCommand("reviewer", {
		description: "Review the current changes via an isolated read-only subagent.",
		handler: async (argsText, ctx) => {
			const profile = loadProfile("reviewer");
			const result = await runSubagent({
				profile,
				prompt: argsText || "Review the current branch vs its upstream.",
				cwd: ctx.cwd,
				model: ctx.model,
				signal: ctx.signal,
			});
			ctx.ui.notify(`${result.answer}\n\n${formatUsage(result.usage)}`, "info");
		},
	});

	// --- Memory layer (vendored mnemopi; FTS5-only recall in the first port) ---

	pi.registerTool({
		name: "remember",
		label: "Remember",
		description:
			"Persist a fact or observation into project-scoped long-term memory (SQLite). " +
			"Use for decisions, preferences, and context worth recalling across sessions.",
		parameters: RememberParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const id = rememberFact(ctx.cwd, params);
			return {
				content: [{ type: "text", text: `Remembered (id=${id}).` }],
				details: { id },
			};
		},
	});

	pi.registerTool({
		name: "recall",
		label: "Recall",
		description:
			"Search project-scoped long-term memory for facts matching a natural-language query. " +
			"Returns the most relevant stored memories (FTS5 + importance ranking).",
		parameters: RecallParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const hits = await recallFacts(ctx.cwd, params);
			const text =
				hits.length === 0
					? "No matching memories."
					: hits.map((h, i) => `${i + 1}. ${h.content}${h.score !== undefined ? ` (score=${h.score.toFixed(3)})` : ""}`).join("\n");
			return {
				content: [{ type: "text", text }],
				details: { count: hits.length },
			};
		},
	});

	// Human-callable: `/recall deployment target`
	pi.registerCommand("recall", {
		description: "Search project memory for facts matching a query.",
		handler: async (argsText, ctx) => {
			const query = argsText.trim();
			if (!query) {
				ctx.ui.notify("Usage: /recall <query>", "warning");
				return;
			}
			const hits = await recallFacts(ctx.cwd, { query });
			const text =
				hits.length === 0
					? "No matching memories."
					: hits.map((h, i) => `${i + 1}. ${h.content}`).join("\n");
			ctx.ui.notify(text, "info");
		},
	});
}
