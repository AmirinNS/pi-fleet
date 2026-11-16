// Stub: mnemopi core/beam/consolidate.ts (MIT source, dropped in the first port).
//
// The full consolidate module (episodic consolidation / sleep / veracity /
// pattern extraction) is LLM- and embedding-coupled and is deferred. This stub
// exports the names `beam/index.ts` and `beam/store.ts` import, as no-ops, so
// the vendored core compiles and `remember`/`recall` work end-to-end without
// the consolidation subsystem. The `storeExtractedFactCategories` no-op is
// only reached when `remember()` is called with `extract: true` (off by
// default); it stores nothing.

import type { BeamMemoryState, BeamStats, MemoriaRetrieveResult, SleepResult } from "./types.ts";

export function consolidateToEpisodic(
	_beam: BeamMemoryState,
	_summary: string,
	_sourceWmIds: readonly string[],
	_source = "consolidation",
	_importance = 0.6,
): string {
	return "";
}

export function degradeEpisodic(_beam: BeamMemoryState, _dryRun = false): Record<string, unknown> {
	return {};
}

export function detectLanguage(_beam: BeamMemoryState, _text: string): string {
	return "en";
}

export function extractAndStoreFacts(
	_beam: BeamMemoryState,
	_content: string,
	_messageIdx = 0,
	_sourceMemoryId: string | null = null,
): Record<string, unknown> {
	return {};
}

export function getConsolidationLog(_beam: BeamMemoryState, _limit = 10): unknown[] {
	return [];
}

export function getContaminated(_beam: BeamMemoryState, _limit = 50, _minImportance = 0.0): unknown[] {
	return [];
}

export function getEpisodicStats(
	_beam: BeamMemoryState,
	_authorId: string | null = null,
	_authorType: string | null = null,
	_channelId: string | null = null,
): BeamStats {
	return { total: 0, oldest: null, newest: null, sources: {}, tiers: {} } as unknown as BeamStats;
}

export function getMemoriaStats(_beam: BeamMemoryState): BeamStats {
	return { total: 0, oldest: null, newest: null, sources: {}, tiers: {} } as unknown as BeamStats;
}

export function health(_beam: BeamMemoryState, _staleThresholdHours = 24.0): Record<string, unknown> {
	return {};
}

export function memoriaRetrieve(
	_beam: BeamMemoryState,
	_query: string,
	_ability: string | null = null,
	_topK = 10,
): MemoriaRetrieveResult {
	return { results: [], ability: null } as unknown as MemoriaRetrieveResult;
}

export function sleep(_beam: BeamMemoryState, _dryRun = false): SleepResult {
	return { consolidated: 0, degraded: 0, episodes: 0, dryRun: _dryRun } as unknown as SleepResult;
}

export function sleepAllSessions(_beam: BeamMemoryState, _dryRun = false): SleepResult {
	return { consolidated: 0, degraded: 0, episodes: 0, dryRun: _dryRun } as unknown as SleepResult;
}

export function storeExtractedFactCategories(
	_beam: BeamMemoryState,
	_extracted: unknown,
	_messageIdx = 0,
	_sourceMemoryId: string | null = null,
	_importance = 0.7,
): number {
	return 0;
}