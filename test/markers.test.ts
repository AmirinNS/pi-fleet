import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, NO_CHANGES, REQUIRES_APPROVAL } from "../src/markers.ts";

test("plain plan → proceed, marker stripped is just the trimmed text", () => {
	const text = "1. Do thing A\n2. Do thing B";
	const got = parsePlan(text);
	assert.equal(got.verdict, "proceed");
	assert.equal(got.ask, undefined);
	assert.equal(got.plan, text);
});

test("[no_changes] → no_changes verdict, marker stripped from plan", () => {
	const text = `Everything is already in place.\n${NO_CHANGES}`;
	const got = parsePlan(text);
	assert.equal(got.verdict, "no_changes");
	assert.equal(got.ask, undefined);
	assert.equal(got.plan, "Everything is already in place.");
});

test("[planner_requires_approval] → requires_approval verdict", () => {
	const text = `1. Delete the build dir\n2. Rebuild\n${REQUIRES_APPROVAL}`;
	const got = parsePlan(text);
	assert.equal(got.verdict, "requires_approval");
	assert.equal(got.ask, undefined);
	assert.equal(got.plan, "1. Delete the build dir\n2. Rebuild");
});

test("<planner-ask> block → ask parsed with question + options, block stripped", () => {
	const text = [
		"I need a decision before planning.",
		"<planner-ask>",
		"question: Which library should we use?",
		"options: [react, vue, svelte]",
		"</planner-ask>",
	].join("\n");
	const got = parsePlan(text);
	assert.equal(got.verdict, "proceed");
	assert.ok(got.ask, "ask should be present");
	assert.equal(got.ask!.question, "Which library should we use?");
	assert.deepEqual(got.ask!.options, ["react", "vue", "svelte"]);
	assert.equal(got.plan, "I need a decision before planning.");
});

test("<planner-ask> without options field → empty options array, question falls back to body", () => {
	const text = "<planner-ask>\nquestion: Ship now or wait?\n</planner-ask>";
	const got = parsePlan(text);
	assert.ok(got.ask);
	assert.equal(got.ask!.question, "Ship now or wait?");
	assert.deepEqual(got.ask!.options, []);
});

test("ask block takes precedence over a trailing [no_changes]", () => {
	const text = `<planner-ask>\nquestion: which branch?\noptions: [main, dev]\n</planner-ask>\n${NO_CHANGES}`;
	const got = parsePlan(text);
	assert.ok(got.ask, "ask wins over no_changes");
	assert.equal(got.verdict, "proceed");
});

test("whitespace-only plan with no marker → proceed with empty plan", () => {
	const got = parsePlan("   \n  ");
	assert.equal(got.verdict, "proceed");
	assert.equal(got.plan, "");
});