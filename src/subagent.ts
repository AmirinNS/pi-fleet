/**
 * The subagent runtime: spawn an isolated, ephemeral child session, run it to
 * completion, and return ONLY its final answer.
 *
 * We build on pi's own `createAgentSession()` SDK rather than hand-wiring a raw
 * `Agent`: it resolves the model, tools, auth, and compaction the same way the
 * interactive CLI does, and `SessionManager.inMemory()` keeps the child
 * throwaway. Model-agnostic — the child model is whatever the caller passes.
 */

import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model, Usage } from "@earendil-works/pi-ai";
import { cacheStrategyFor } from "./providers.ts";
import type { Profile } from "./profiles.ts";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
const CODING_TOOLS = ["read", "grep", "find", "ls", "edit", "write", "bash"] as const;

export interface RunSubagentArgs {
	profile: Profile;
	prompt: string;
	cwd: string;
	/** Child model. Defaults (undefined) to the session's configured default. */
	model: Model<any> | undefined;
	/**
	 * Pin the child's provider session-affinity key (the `x-session-affinity`
	 * header). A stable id keeps a warm prefix pinned to one cache node across
	 * repeated calls — this is what makes the planner/executor sessions
	 * cache-stable. Must match `assertValidSessionId`: start/end alphanumeric,
	 * body `[A-Za-z0-9._-]`.
	 */
	sessionId?: string;
	signal?: AbortSignal;
}

export interface SubagentResult {
	answer: string;
	provider: string;
	/** The session id the child ran under (set when `args.sessionId` was given). */
	sessionId?: string;
	/**
	 * Summed child token usage across all assistant turns in the run
	 * (input/output/cacheRead/cacheWrite/cost). Absent when the run produced no
	 * assistant turn to sum (error/abort) — hence optional, never fabricated.
	 */
	usage?: Usage;
}

/**
 * Sum token `usage` across the assistant messages in a finished run.
 *
	 * Pure: takes the child's `AgentMessage[]` and folds every assistant turn's
	 * `usage`. User and toolResult messages are skipped (they carry no LLM usage).
	 * Optional provider-specific fields (`cacheWrite1h`, `reasoning`) are summed
	 * only when at least one turn reported them, so a provider that omits them
	 * gets back an object that also omits them.
	 */
export function sumUsage(messages: AgentMessage[]): Usage {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cacheWrite = 0;
	let totalTokens = 0;
	let costInput = 0;
	let costOutput = 0;
	let costCacheRead = 0;
	let costCacheWrite = 0;
	let costTotal = 0;
	let cacheWrite1h: number | undefined;
	let reasoning: number | undefined;

	for (const m of messages) {
		if (m.role !== "assistant") continue;
		const mu = m.usage;
		input += mu.input;
		output += mu.output;
		cacheRead += mu.cacheRead;
		cacheWrite += mu.cacheWrite;
		totalTokens += mu.totalTokens;
		costInput += mu.cost.input;
		costOutput += mu.cost.output;
		costCacheRead += mu.cost.cacheRead;
		costCacheWrite += mu.cost.cacheWrite;
		costTotal += mu.cost.total;
		if (mu.cacheWrite1h !== undefined) cacheWrite1h = (cacheWrite1h ?? 0) + mu.cacheWrite1h;
		if (mu.reasoning !== undefined) reasoning = (reasoning ?? 0) + mu.reasoning;
	}

	const result: Usage = {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens,
		cost: {
			input: costInput,
			output: costOutput,
			cacheRead: costCacheRead,
			cacheWrite: costCacheWrite,
			total: costTotal,
		},
	};
	if (cacheWrite1h !== undefined) result.cacheWrite1h = cacheWrite1h;
	if (reasoning !== undefined) result.reasoning = reasoning;
	return result;
}

/** Run a profile as an isolated child session and return its final text. */
export async function runSubagent(args: RunSubagentArgs): Promise<SubagentResult> {
	const strategy = cacheStrategyFor(args.model?.provider);
	const tools = args.profile.tools === "read-only" ? [...READ_ONLY_TOOLS] : [...CODING_TOOLS];

	// The profile body is the FULL child prompt — no implicit default stacked on
	// top (Reasonix rule). systemPromptOverride replaces pi's base prompt entirely.
	// Loader is built the same way createAgentSession() builds its own default.
	const agentDir = getAgentDir();
	const resourceLoader = new DefaultResourceLoader({
		cwd: args.cwd,
		agentDir,
		settingsManager: SettingsManager.create(args.cwd, agentDir),
		systemPromptOverride: () => args.profile.systemPrompt,
	});
	await resourceLoader.reload();

	const { session } = await createAgentSession({
		cwd: args.cwd,
		model: args.model,
		tools,
		resourceLoader,
		// Ephemeral: the child leaves no session file and never touches the parent.
		// When a stable sessionId is given, pin it here so provider session
		// affinity (x-session-affinity) keeps the child's prefix cache warm.
		sessionManager: SessionManager.inMemory(
			args.cwd,
			args.sessionId ? { id: args.sessionId } : undefined,
		),
	});

	try {
		await session.prompt(args.prompt);
		const messages = session.messages;
		return {
			answer: extractFinalText(messages),
			provider: strategy.provider,
			sessionId: args.sessionId,
			usage: sumUsage(messages),
		};
	} finally {
		session.dispose();
	}
}

/** Pull the last assistant message's text out of a finished run. */
function extractFinalText(messages: AgentMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; content?: unknown };
		if (m?.role !== "assistant") continue;
		if (typeof m.content === "string") return m.content;
		if (Array.isArray(m.content)) {
			return m.content
				.filter((c): c is { type: string; text: string } => {
					const b = c as { type?: string; text?: unknown };
					return b?.type === "text" && typeof b.text === "string";
				})
				.map((c) => c.text)
				.join("");
		}
	}
	return "";
}
