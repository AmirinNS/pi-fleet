// B4: tool-layer round-trip. Exercises the `src/memory.ts` wrapper that backs
// the `remember` / `recall` extension tools — remember via the wrapper, recall
// via the wrapper, in a throwaway cwd so no real project DB is touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { rememberFact, recallFacts, closeMemory, getMemory } from "../src/memory.ts";

test("tool layer: remember → recall round-trip", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-fleet-mem-"));
	try {
		rememberFact(cwd, { content: "The cache strategy for DeepSeek is automatic prefix cache.", importance: 0.9 });
		rememberFact(cwd, { content: "pi-fleet's planner and executor run in separate cache-stable sessions." });

		const hits = await recallFacts(cwd, { query: "cache strategy DeepSeek", topK: 3 });
		assert.ok(hits.length > 0, "recall returns the remembered fact");
		const top = hits[0];
		assert.ok(top.content.includes("DeepSeek"), `top hit content mentions DeepSeek: ${top.content}`);
		assert.ok(typeof top.id === "string" && top.id.length > 0, "hit has an id");
	} finally {
		closeMemory(cwd);
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("tool layer: recall with no matches returns an empty array", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-fleet-mem-empty-"));
	try {
		rememberFact(cwd, { content: "A fact about apples." });
		const hits = await recallFacts(cwd, { query: "quantum teleportation circuits", topK: 3 });
		assert.equal(hits.length, 0, "unrelated query yields no hits");
	} finally {
		closeMemory(cwd);
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("tool layer: close + reopen persists facts across instances", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-fleet-mem-reopen-"));
	try {
		rememberFact(cwd, { content: "pi-fleet runs the planner and executor in separate sessions.", importance: 0.9 });
		const before = await recallFacts(cwd, { query: "planner executor", topK: 3 });
		assert.ok(before.length > 0, "fact recalled before close");

		closeMemory(cwd);
		// A fresh session on the same cwd must see the persisted fact.
		const after = await recallFacts(cwd, { query: "planner executor", topK: 3 });
		assert.ok(after.length > 0, "fact survives close + reopen");
		assert.match(after[0].content, /planner and executor/);
	} finally {
		closeMemory(cwd);
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("tool layer: deferred subsystems are safe no-ops (sleep/getContext)", () => {
	// The consolidate/sleep subsystem is stubbed in the first port. These are
	// not exposed as tools, but the underlying facade still callable: they must
	// return a benign result and never throw.
	const cwd = mkdtempSync(join(tmpdir(), "pi-fleet-mem-stub-"));
	try {
		rememberFact(cwd, { content: "a fact" });
		const mem = getMemory(cwd);
		const sleepRes = mem.sleep(false) as { consolidated?: number };
		assert.ok(typeof sleepRes === "object" && sleepRes !== null, "sleep() returns a result object");
		assert.equal(sleepRes.consolidated, 0, "sleep() is a no-op (nothing consolidated)");
		const ctx = mem.getContext(5);
		assert.ok(Array.isArray(ctx), "getContext() returns an array");
	} finally {
		closeMemory(cwd);
		rmSync(cwd, { recursive: true, force: true });
	}
});