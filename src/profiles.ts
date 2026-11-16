/**
 * Subagent profiles. A profile is the FULL system prompt for an isolated child
 * agent plus its tool posture. Profiles are model-agnostic; the caller may pick
 * any provider/model for the child.
 */

export type ToolPosture = "read-only" | "coding";

export interface Profile {
	readonly name: string;
	readonly description: string;
	readonly systemPrompt: string;
	readonly tools: ToolPosture;
	/** Optional model override, e.g. run reviewer on a cheaper/stronger model. */
	readonly model?: { provider: string; modelId: string };
}

const reviewer: Profile = {
	name: "reviewer",
	description: "Review the current changes for correctness and regressions.",
	tools: "read-only",
	systemPrompt: [
		"You are a code-review subagent.",
		"Review the changes about to ship (current branch vs upstream) and report",
		"actionable findings only: correctness bugs, regressions, clear risks. For each,",
		"give file:line, what's wrong, and the fix. Skip style nits. Say so if nothing",
		"is wrong. No memory beyond this task — one distilled answer.",
	].join(" "),
};

/**
 * Planner: read-only. Produces an executor-ready plan, researches with read-only
 * tools only, never writes/executes. Ends with exactly one of the three markers
 * defined in `markers.ts`. Adapted from Reasonix's DefaultPlannerPrompt.
 */
const planner: Profile = {
	name: "planner",
	description: "Research the task read-only and produce an executor-ready plan.",
	tools: "read-only",
	systemPrompt: [
		"You are the PLANNER in a planner/executor pipeline.",
		"Research the task with READ-ONLY tools only (read, grep, find, ls), then",
		"produce one ordered, executor-ready plan. Never write or execute.",
		"The plan must be concrete and self-contained: numbered steps, each naming",
		"the file and the change, so the executor needs no re-derivation. Smallest",
		"change that meets the goal.",
		"",
		"End with EXACTLY ONE marker on its own line:",
		"- [no_changes] — nothing needs to change.",
		"- [planner_requires_approval] — side effects; must be approved first.",
		"- <planner-ask>... question ... options: [a, b, c] </planner-ask> — a user-owned",
		"  decision the caller will surface.",
		"Omit all markers to just proceed. No memory beyond this task — one distilled answer.",
	].join("\n"),
};

/**
 * Executor: coding tools. Carries out an approved plan with focused changes.
 */
const executor: Profile = {
	name: "executor",
	description: "Carry out an approved plan with coding tools.",
	tools: "coding",
	systemPrompt: [
		"You are the EXECUTOR in a planner/executor pipeline.",
		"Carry out the plan with your tools (read, grep, find, ls, edit, write, bash).",
		"Stay tightly scoped to the plan — no refactors or scope creep. Match existing style.",
		"Before declaring done, VERIFY your change (run the test/lint/build, or re-read the",
		"edited code) and report the result. Then summarize what you changed.",
		"No memory beyond this task — one distilled answer.",
	].join(" "),
};

const PROFILES: Record<string, Profile> = {
	[reviewer.name]: reviewer,
	[planner.name]: planner,
	[executor.name]: executor,
};

export function loadProfile(name: string): Profile {
	const p = PROFILES[name];
	if (!p) throw new Error(`unknown subagent profile: ${name}`);
	return p;
}

export function profileNames(): string[] {
	return Object.keys(PROFILES);
}
