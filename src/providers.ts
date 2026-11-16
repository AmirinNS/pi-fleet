/**
 * The ONLY place in pi-fleet that knows about specific providers.
 *
 * Every orchestration feature (subagents, planner/executor, guardian,
 * compaction) is model-agnostic. What actually differs between DeepSeek, GLM,
 * Kimi, and the Anthropic/OpenAI families is *how their prefix/context cache
 * works* — so that, and only that, is captured here as a strategy.
 *
 * An unrecognised provider MUST fall back to `defaultStrategy` and keep working.
 */

export interface CacheStrategy {
	/** Human label for telemetry/logs. */
	readonly provider: string;
	/**
	 * True when the backend caches by a stable session-affinity id (DeepSeek,
	 * GLM, Kimi). We then hand each long-lived agent a distinct, stable
	 * `sessionId` so its warm prefix stays pinned to one cache node.
	 */
	readonly usesSessionAffinity: boolean;
	/**
	 * True when the backend caches automatically by matching the request prefix
	 * (no explicit markers). Our job is then purely to keep the prefix
	 * byte-stable across turns.
	 */
	readonly automaticPrefixCache: boolean;
	/**
	 * True when the backend uses explicit cache breakpoints (Anthropic/OpenAI
	 * `cache_control`). pi already emits these; we just must not bust the prefix.
	 */
	readonly usesExplicitCacheControl: boolean;
	/**
	 * GLM interleaved/preserved thinking: `reasoning_content` from earlier turns
	 * must be replayed unchanged or the cache (and correctness) degrade.
	 */
	readonly preserveReasoningContent: boolean;
}

const deepseek: CacheStrategy = {
	provider: "deepseek",
	usesSessionAffinity: true,
	automaticPrefixCache: true,
	usesExplicitCacheControl: false,
	preserveReasoningContent: false,
};

const glm: CacheStrategy = {
	provider: "glm",
	usesSessionAffinity: true,
	automaticPrefixCache: true,
	usesExplicitCacheControl: false,
	preserveReasoningContent: true, // GLM-specific
};

const kimi: CacheStrategy = {
	provider: "kimi",
	usesSessionAffinity: true,
	automaticPrefixCache: true,
	usesExplicitCacheControl: false,
	preserveReasoningContent: false,
};

const explicit: CacheStrategy = {
	provider: "explicit-cache-control",
	usesSessionAffinity: false,
	automaticPrefixCache: false,
	usesExplicitCacheControl: true,
	preserveReasoningContent: false,
};

/** Best-effort: keep the prefix stable + a stable sessionId; assume nothing else. */
export const defaultStrategy: CacheStrategy = {
	provider: "unknown",
	usesSessionAffinity: true,
	automaticPrefixCache: true,
	usesExplicitCacheControl: false,
	preserveReasoningContent: false,
};

/**
 * Map a pi provider id (as seen on `model.provider`) to a cache strategy.
 * Matching is substring-based so gateway/proxy provider ids still resolve.
 */
export function cacheStrategyFor(provider: string | undefined): CacheStrategy {
	const p = (provider ?? "").toLowerCase();
	if (p.includes("deepseek")) return deepseek;
	if (p.includes("glm") || p.includes("zhipu") || p.includes("zai") || p.includes("bigmodel")) return glm;
	if (p.includes("kimi") || p.includes("moonshot")) return kimi;
	if (p.includes("anthropic") || p.includes("openai") || p.includes("claude")) return explicit;
	return defaultStrategy;
}
