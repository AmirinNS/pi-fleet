import { test } from "node:test";
import assert from "node:assert/strict";
import { runPlanExecute } from "../src/coordinator.ts";
import type { RunSubagentArgs, SubagentResult } from "../src/subagent.ts";

/**
 * Build a stub runner that records each call and returns a canned answer.
 * The Nth entry in `answers` is returned for the Nth call (planner is call 0,
 * executor is call 1). Calls beyond the list throw.
 */
function stubRunner(answers: string[], calls: RunSubagentArgs[]) {
	return async (args: RunSubagentArgs): Promise<SubagentResult> => {
		calls.push(args);
		const idx = calls.length - 1;
		const answer = answers[idx];
		if (answer === undefined) throw new Error(`stubRunner: no answer for call ${idx}`);
		return { answer, provider: "stub", sessionId: args.sessionId };
	};
}

const baseArgs = { task: "do the thing", cwd: "/tmp" };

test("no_changes → returns no_changes, executor never runs", async () => {
	const calls: RunSubagentArgs[] = [];
	const res = await runPlanExecute({
		...baseArgs,
		_runSubagent: stubRunner(["nothing to do [no_changes]"], calls),
	});
	assert.equal(res.status, "no_changes");
	assert.equal((res as { plan: string }).plan, "nothing to do");
	assert.equal(calls.length, 1, "only the planner runs");
	assert.equal(calls[0].sessionId, "pi-fleet.planner");
	assert.equal(calls[0].profile.name, "planner");
});

test("proceed → executor runs on a separate stable sessionId", async () => {
	const calls: RunSubagentArgs[] = [];
	const res = await runPlanExecute({
		...baseArgs,
		_runSubagent: stubRunner(["1. make the change\n2. verify", "done, edited foo.ts"], calls),
	});
	assert.equal(res.status, "executed");
	assert.equal(res.status === "executed" && res.result.answer, "done, edited foo.ts");
	assert.equal(res.status === "executed" && res.plan, "1. make the change\n2. verify");
	assert.equal(calls.length, 2);
	assert.equal(calls[0].sessionId, "pi-fleet.planner");
	assert.equal(calls[1].sessionId, "pi-fleet.executor");
	assert.equal(calls[0].profile.name, "planner");
	assert.equal(calls[1].profile.name, "executor");
});

test("requires_approval with no approver → fail-closed needs_approval, executor skipped", async () => {
	const calls: RunSubagentArgs[] = [];
	const res = await runPlanExecute({
		...baseArgs,
		_runSubagent: stubRunner(["1. risky change [planner_requires_approval]"], calls),
	});
	assert.equal(res.status, "needs_approval");
	assert.equal(calls.length, 1, "executor must not run without approval");
});

test("requires_approval, approver says yes → executor runs (executed)", async () => {
	const calls: RunSubagentArgs[] = [];
	const approveCalls: string[] = [];
	const res = await runPlanExecute({
		...baseArgs,
		approve: async (plan) => {
			approveCalls.push(plan);
			return true;
		},
		_runSubagent: stubRunner(["1. risky change [planner_requires_approval]", "applied it"], calls),
	});
	assert.equal(res.status, "executed");
	assert.equal(approveCalls.length, 1);
	assert.equal(approveCalls[0], "1. risky change");
	assert.equal(calls.length, 2);
});

test("requires_approval, approver says no → needs_approval, executor skipped", async () => {
	const calls: RunSubagentArgs[] = [];
	const res = await runPlanExecute({
		...baseArgs,
		approve: async () => false,
		_runSubagent: stubRunner(["1. risky change [planner_requires_approval]"], calls),
	});
	assert.equal(res.status, "needs_approval");
	assert.equal(calls.length, 1);
});

test("planner-ask → needs_input surfaces question + options, executor skipped", async () => {
	const calls: RunSubagentArgs[] = [];
	const res = await runPlanExecute({
		...baseArgs,
		_runSubagent: stubRunner(
			[
				[
					"<planner-ask>",
					"question: which branch?",
					"options: [main, dev]",
					"</planner-ask>",
				].join("\n"),
			],
			calls,
		),
	});
	assert.equal(res.status, "needs_input");
	if (res.status !== "needs_input") throw new Error("unreachable");
	assert.equal(res.ask.question, "which branch?");
	assert.deepEqual(res.ask.options, ["main", "dev"]);
	assert.equal(calls.length, 1, "executor must not run when input is needed");
});

test("planner read-only, executor coding — tool posture is correct", async () => {
	const calls: RunSubagentArgs[] = [];
	await runPlanExecute({
		...baseArgs,
		_runSubagent: stubRunner(["1. do it", "done"], calls),
	});
	assert.equal(calls[0].profile.tools, "read-only");
	assert.equal(calls[1].profile.tools, "coding");
});