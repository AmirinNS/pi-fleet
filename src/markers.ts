/**
 * Planner marker parsing — pure, no I/O.
 *
 * The planner profile ends its response with exactly one of three markers (or
 * none, meaning "proceed"). This module turns a planner answer into a verdict
 * the coordinator can branch on.
 *
 * Markers (adapted from Reasonix's DefaultPlannerPrompt):
 *   [no_changes]                       — nothing to do
 *   [planner_requires_approval]        — side effects; gate the executor
 *   <planner-ask>…</planner-ask>       — a user-owned decision to surface
 *
 * A `<planner-ask>` block has the shape:
 *   <planner-ask>
 *   question: ...
 *   options: [a, b, c]
 *   </planner-ask>
 */

export const NO_CHANGES = "[no_changes]";
export const REQUIRES_APPROVAL = "[planner_requires_approval]";
export const ASK_OPEN = "<planner-ask>";
export const ASK_CLOSE = "</planner-ask>";

export type PlanVerdict = "proceed" | "no_changes" | "requires_approval";

export interface PlanAsk {
	/** The question the planner wants the user to decide. */
	question: string;
	/** Parsed option strings, when the planner listed `options: [...]`. */
	options: string[];
}

export interface ParsedPlan {
	/** The planner text with the terminal marker / ask block stripped. */
	plan: string;
	verdict: PlanVerdict;
	/** Present only when the planner emitted a `<planner-ask>` block. */
	ask?: PlanAsk;
}

/**
 * Parse a planner answer into a verdict + cleaned plan.
 *
 * The marker is searched anywhere in the text (planners occasionally add a
 * trailing sentence after the marker). The first recognised marker wins, with
 * precedence: ask block > approval > no_changes, so an ask block that also
 * contains `[no_changes]` is treated as `needs_input` (the question is the
 * actionable signal).
 */
export function parsePlan(text: string): ParsedPlan {
	const askBlock = parseAskBlock(text);
	if (askBlock) {
		return {
			plan: stripAskBlock(text).trim(),
			verdict: "proceed",
			ask: askBlock,
		};
	}

	if (text.includes(REQUIRES_APPROVAL)) {
		return {
			plan: stripMarker(text, REQUIRES_APPROVAL).trim(),
			verdict: "requires_approval",
		};
	}

	if (text.includes(NO_CHANGES)) {
		return {
			plan: stripMarker(text, NO_CHANGES).trim(),
			verdict: "no_changes",
		};
	}

	return { plan: text.trim(), verdict: "proceed" };
}

/** Extract the first `<planner-ask>…</planner-ask>` block, or null. */
function parseAskBlock(text: string): PlanAsk | null {
	const open = text.indexOf(ASK_OPEN);
	if (open === -1) return null;
	const close = text.indexOf(ASK_CLOSE, open + ASK_OPEN.length);
	if (close === -1) return null;

	const body = text.slice(open + ASK_OPEN.length, close);
	return parseAskBody(body);
}

/** Pull `question:` and `options: [...]` out of an ask block body. */
function parseAskBody(body: string): PlanAsk {
	const question = matchField(body, "question");
	const optionsRaw = matchField(body, "options");
	const options = optionsRaw ? parseOptions(optionsRaw) : [];
	return { question: question ?? body.trim(), options };
}

/** Match `field: value` (first occurrence) anywhere in the body; returns trimmed value. */
function matchField(body: string, field: string): string | undefined {
	const re = new RegExp(`(?:^|\\n)\\s*${field}\\s*:\\s*(.*)`, "i");
	const m = body.match(re);
	return m ? m[1].trim() : undefined;
}

/** Parse a bracketed `[a, b, c]` or bare `a, b, c` option list into trimmed strings. */
function parseOptions(raw: string): string[] {
	const trimmed = raw.trim();
	const inner = trimmed.startsWith("[") && trimmed.endsWith("]")
		? trimmed.slice(1, -1)
		: trimmed;
	return inner
		.split(",")
		.map((o) => o.trim())
		.filter((o) => o.length > 0);
}

function stripAskBlock(text: string): string {
	const open = text.indexOf(ASK_OPEN);
	if (open === -1) return text;
	const close = text.indexOf(ASK_CLOSE, open + ASK_OPEN.length);
	if (close === -1) return text;
	return text.slice(0, open) + text.slice(close + ASK_CLOSE.length);
}

function stripMarker(text: string, marker: string): string {
	const i = text.indexOf(marker);
	if (i === -1) return text;
	return text.slice(0, i) + text.slice(i + marker.length);
}