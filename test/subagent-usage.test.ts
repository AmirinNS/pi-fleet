import { test } from "node:test";
import assert from "node:assert/strict";
import { sumUsage } from "../src/subagent.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";

/** Build a Usage object with known values. Cost sub-fields default to zero. */
function usage(
	input: number,
	output: number,
	cacheRead = 0,
	cacheWrite = 0,
	costTotal = 0,
): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: costTotal },
	};
}

/** Build a minimal assistant message carrying the given usage. */
function assistant(u: Usage): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: "openai",
		provider: "stub",
		model: "stub-model",
		usage: u,
		stopReason: "stop",
		timestamp: 0,
	};
}

/** A user message that must be skipped (no usage field). */
function user(): AgentMessage {
	return { role: "user", content: "hi", timestamp: 0 };
}

/** A toolResult message that must be skipped (optional usage absent). */
function toolResult(): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: "c1",
		toolName: "read",
		content: [{ type: "text", text: "file contents" }],
		isError: false,
		timestamp: 0,
	};
}

test("sumUsage sums input/output/cacheRead/cacheWrite/cost across assistant turns", () => {
	const messages: AgentMessage[] = [
		user(),
		assistant(usage(100, 20, 50, 10, 0.01)),
		toolResult(),
		assistant(usage(200, 40, 80, 20, 0.02)),
	];
	const u = sumUsage(messages);
	assert.equal(u.input, 300);
	assert.equal(u.output, 60);
	assert.equal(u.cacheRead, 130);
	assert.equal(u.cacheWrite, 30);
	assert.equal(u.totalTokens, 520);
	assert.equal(u.cost.total, 0.03);
	assert.equal(u.cost.input, 0);
	assert.equal(u.cost.output, 0);
	assert.equal(u.cost.cacheRead, 0);
	assert.equal(u.cost.cacheWrite, 0);
});

test("sumUsage skips user and toolResult messages", () => {
	const messages: AgentMessage[] = [
		user(),
		toolResult(),
		assistant(usage(100, 20, 0, 0, 0.05)),
	];
	const u = sumUsage(messages);
	assert.equal(u.input, 100);
	assert.equal(u.output, 20);
	assert.equal(u.cost.total, 0.05);
});

test("sumUsage returns zeros for an empty message list", () => {
	const u = sumUsage([]);
	assert.equal(u.input, 0);
	assert.equal(u.output, 0);
	assert.equal(u.cacheRead, 0);
	assert.equal(u.cacheWrite, 0);
	assert.equal(u.totalTokens, 0);
	assert.equal(u.cost.total, 0);
});

test("sumUsage omits optional cacheWrite1h/reasoning when no turn reports them", () => {
	const u = sumUsage([assistant(usage(100, 20))]);
	assert.equal("cacheWrite1h" in u, false);
	assert.equal("reasoning" in u, false);
});

test("sumUsage sums optional fields when at least one turn reports them", () => {
	const u1: Usage = usage(100, 20);
	u1.reasoning = 15;
	const u2: Usage = usage(200, 40);
	u2.reasoning = 25;
	u2.cacheWrite1h = 5;
	const u = sumUsage([assistant(u1), assistant(u2)]);
	assert.equal(u.reasoning, 40);
	assert.equal(u.cacheWrite1h, 5);
});