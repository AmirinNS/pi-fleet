// Vendored from can1357/oh-my-pi (MIT License, Copyright (c) 2025 Mario Zechner,
// 2025-2026 Can Bölük). Upstream commit 3a8591a8af5b6d200088d12ca75a5517cb064fa8.
// Ported to Node/upstream pi — see THIRD_PARTY.md for the change list.

/**
 * mnemopi port — re-wiring adapters.
 *
 * Replaces the four forked omp dependencies with upstream/Node equivalents or
 * thin stubs, so the vendored mnemopi code never imports `@oh-my-pi/*`.
 *
 *   @oh-my-pi/pi-ai           → `@earendil-works/pi-ai` types + local ApiKey
 *   @oh-my-pi/pi-utils        → local `logger` (mnemopi already ships util/lru)
 *   @oh-my-pi/pi-natives      → dropped (in-file JS fallbacks; see mmr.ts)
 *   @oh-my-pi/pi-catalog/hosts → local `hostMatchesUrl` (leaf URL matcher)
 *
 * Only the surface the first-port core path touches is implemented. The
 * embedding/LLM auth helpers (`withAuth`, `getOpenRouterHeaders`,
 * `ProviderHttpError`, `FetchImpl`) are stubbed — they are only reached on the
 * deferred embeddings/LLM paths, which are no-ops in this port.
 */

// --- pi-ai types (upstream) -------------------------------------------------

export type { Api, Model } from "@earendil-works/pi-ai";

/**
 * omp's `ApiKey` is `string | ApiKeyResolver`. The first port wires no
 * embedding/LLM API keys, so a plain string alias is sufficient for typing the
 * facade options. Callers that do not supply a key pass `undefined`.
 */
export type ApiKey = string;

// --- logger (replaces @oh-my-pi/pi-utils logger) ---------------------------

type LogLevel = "debug" | "info" | "warn" | "error";

function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
	if (process.env.MNEMOPI_DEBUG === "1" || level === "warn" || level === "error") {
		const prefix = `[mnemopi:${level}]`;
		const payload = data === undefined ? "" : ` ${JSON.stringify(data)}`;
		// eslint-disable-next-line no-console
		console.error(`${prefix} ${message}${payload}`);
	}
}

export const logger = {
	debug: (message: string, data?: Record<string, unknown>) => log("debug", message, data),
	info: (message: string, data?: Record<string, unknown>) => log("info", message, data),
	warn: (message: string, data?: Record<string, unknown>) => log("warn", message, data),
	error: (message: string, data?: Record<string, unknown>) => log("error", message, data),
};

// --- hostMatchesUrl (replaces @oh-my-pi/pi-catalog/hosts) ------------------

/**
 * Case-insensitive substring match against a base URL — the exact semantics of
 * omp's `hostMatchesUrl` (markers are lowercased ASCII substrings, not parsed
 * hostnames). mnemopi only ever calls this with `host = "openrouter"`.
 */
export function hostMatchesUrl(baseUrl: string | undefined, host: string): boolean {
	if (!baseUrl) return false;
	const needle = host.toLowerCase();
	const haystack = baseUrl.toLowerCase();
	return haystack.includes(needle);
}

// --- Deferred embedding/LLM auth stubs --------------------------------------
// These are only imported by the deferred embeddings/LLM/extraction modules,
// which are stubbed to no-ops in the first port. They exist so those modules
// compile; they are never reached at runtime.

export type FetchImpl = typeof globalThis.fetch;

export class ProviderHttpError extends Error {
	readonly status?: number;
	constructor(message: string, status?: number) {
		super(message);
		this.name = "ProviderHttpError";
		this.status = status;
	}
}

/** No-op auth wrapper — the first port performs no authenticated fetches. */
export async function withAuth<T>(
	_key: ApiKey | undefined,
	fn: () => T | Promise<T>,
): Promise<T> {
	return fn();
}

/** Stub — no OpenRouter-specific headers in the first port. */
export function getOpenRouterHeaders(_key: ApiKey | undefined): Record<string, string> {
	return {};
}