/**
 * The planner/executor coordinator.
 *
 * Chains a read-only **planner** subagent → (optional approval gate) → a
 * tool-using **executor** subagent, each running as its own cache-stable session
 * with a distinct, stable `sessionId` so each prefix stays pinned to one cache
 * node across repeated `/plan` calls. This is pi-fleet's core differentiator.
 *
 * The coordinator is model-agnostic; the model is whatever the caller passes.
 * It never branches on the provider.
 */

import type { Model, Usage } from "@earendil-works/pi-ai";
import { loadProfile } from "./profiles.ts";
import { parsePlan } from "./markers.ts";
import type { RunSubagentArgs, SubagentResult } from "./subagent.ts";

/**
 * Lazy default runner. Imported dynamically so that callers that inject a
 * `_runSubagent` stub (notably the unit tests) never pull in the pi packages,
 * which are peer dependencies and may not be installed in every environment.
 */
let _realRunner: ((args: RunSubagentArgs) => Promise<SubagentResult>) | undefined;
async function realRunner(args: RunSubagentArgs): Promise<SubagentResult> {
	if (!_realRunner) {
		const mod = await import("./subagent.ts");
		_realRunner = mod.runSubagent;
	}
	return _realRunner(args);
}

/**
 * Distinct, stable session ids for the two long-lived children.
 * Must satisfy `assertValidSessionId`: `[A-Za-z0-9._-]`, alphanumeric at both
 * ends — so dots, not colons.
 */
const PLANNER_SESSION_ID = "pi-fleet.planner";
const EXECUTOR_SESSION_ID = "pi-fleet.executor";

export interface RunPlanExecuteArgs {
	task: string;
	cwd: string;
	/** Model for the planner. Defaults to the session's configured default. */
	plannerModel?: Model<any>;
	/** Model for the executor. Defaults to the session's configured default. */
	executorModel?: Model<any>;
	/**
	 * Interactive approval seam. Called only when the planner emits
	 * `[planner_requires_approval]`. Returning true runs the executor; false
	 * returns `needs_approval` without executing. When absent (headless /
	 * LLM-callable tool), the coordinator is fail-closed: it returns
	 * `needs_approval` rather than running side effects unattended.
	 */
	approve?: (plan: string) => Promise<boolean>;
	signal?: AbortSignal;
	/** @internal Test seam; defaults to the real runSubagent. */
	_runSubagent?: (args: RunSubagentArgs) => Promise<SubagentResult>;
}

export type CoordinatorResult =
	| { status: "no_changes"; plan: string; plannerUsage?: Usage }
	| { status: "needs_approval"; plan: string; plannerUsage?: Usage }
	| { status: "needs_input"; plan: string; ask: { question: string; options: string[] }; plannerUsage?: Usage }
	| { status: "executed"; plan: string; result: SubagentResult; plannerUsage?: Usage; executorUsage?: Usage };

/** Run planner → gate → executor. */
export async function runPlanExecute(args: RunPlanExecuteArgs): Promise<CoordinatorResult> {
	const run = args._runSubagent ?? realRunner;
	const planner = loadProfile("planner");

	// Step 1 — planner: read-only research, produces a plan + verdict.
	const plannerResult = await run({
		profile: planner,
		prompt: args.task,
		cwd: args.cwd,
		model: args.plannerModel,
		sessionId: PLANNER_SESSION_ID,
		signal: args.signal,
	});

	// Step 2 — parse the planner's marker and branch.
	const parsed = parsePlan(plannerResult.answer);

	if (parsed.ask) {
		// A user-owned decision the coordinator cannot auto-answer.
		return { status: "needs_input", plan: parsed.plan, ask: parsed.ask, plannerUsage: plannerResult.usage };
	}

	if (parsed.verdict === "no_changes") {
		return { status: "no_changes", plan: parsed.plan, plannerUsage: plannerResult.usage };
	}

	if (parsed.verdict === "requires_approval") {
		// Fail-closed when there is no interactive approver.
		if (!args.approve) return { status: "needs_approval", plan: parsed.plan, plannerUsage: plannerResult.usage };
		const ok = await args.approve(parsed.plan);
		if (!ok) return { status: "needs_approval", plan: parsed.plan, plannerUsage: plannerResult.usage };
		// approved → fall through to the executor.
	}

	// Step 3 — executor: carry out the plan with coding tools.
	const executor = loadProfile("executor");
	const executorResult = await run({
		profile: executor,
		prompt: parsed.plan,
		cwd: args.cwd,
		model: args.executorModel,
		sessionId: EXECUTOR_SESSION_ID,
		signal: args.signal,
	});

	return {
		status: "executed",
		plan: parsed.plan,
		result: executorResult,
		plannerUsage: plannerResult.usage,
		executorUsage: executorResult.usage,
	};
}