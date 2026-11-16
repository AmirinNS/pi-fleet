/**
 * pi-fleet memory layer — wraps the vendored mnemopi facade as project-scoped
 * extension tools (`remember` / `recall`).
 *
 * A single `Mnemopi` instance is lazily created per `cwd` and backed by a
 * SQLite database at `<cwd>/.pi/mnemopi.db`. The first port runs with
 * embeddings disabled, so recall is FTS5 + importance only (the dense/vec
 * score is zero); see `plans/mnemopi-spike-notes.md` and `THIRD_PARTY.md`.
 */

import { join } from "node:path";
import { Mnemopi } from "./vendor/mnemopi/core/memory.ts";

const instances = new Map<string, Mnemopi>();

/** Return the project-scoped memory instance for `cwd`, creating it on first use. */
export function getMemory(cwd: string): Mnemopi {
	let mem = instances.get(cwd);
	if (mem === undefined) {
		mem = new Mnemopi({ dbPath: join(cwd, ".pi", "mnemopi.db"), noEmbeddings: true });
		instances.set(cwd, mem);
	}
	return mem;
}

/** Close and drop the cached instance for `cwd` (used by tests). */
export function closeMemory(cwd: string): void {
	const mem = instances.get(cwd);
	if (mem !== undefined) {
		mem.close();
		instances.delete(cwd);
	}
}

export interface RememberArgs {
	readonly content: string;
	readonly importance?: number;
	readonly source?: string;
}

/** Store a fact; returns the new memory id. */
export function rememberFact(cwd: string, args: RememberArgs): string {
	return getMemory(cwd).remember(args.content, {
		source: args.source ?? "agent",
		importance: args.importance ?? 0.5,
	});
}

export interface RecallArgs {
	readonly query: string;
	readonly topK?: number;
}

/** Recall facts matching `query`; returns `{ id, content, score }[]`. */
export async function recallFacts(
	cwd: string,
	args: RecallArgs,
): Promise<Array<{ id: string; content: string; score?: number; source?: string }>> {
	const results = await getMemory(cwd).recall(args.query, args.topK ?? 5);
	return results.map((r) => ({
		id: r.id,
		content: r.content,
		score: r.score,
		source: (r as { source?: string }).source,
	}));
}