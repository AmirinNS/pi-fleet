// Stub: mnemopi core/vector-index.ts (MIT source, deferred). The exact
// cosine vector index is only used by SHMR / in-memory vec search paths, which
// are no-ops without embeddings. The builders return empty indexes and searches
// return no hits, so callers degrade gracefully.

export interface ExactVectorSearchHit<TId> {
	id: TId;
	score: number;
}

export interface ExactVectorIndex<TId> {
	readonly ids: readonly TId[];
	readonly matrix: Float32Array;
	readonly dimensions: number;
	readonly count: number;
}

export interface VectorIndexRow<TId> {
	id: TId;
	vector: readonly number[] | null | undefined;
}

export function buildExactVectorIndex<TId>(_rows: readonly VectorIndexRow<TId>[]): ExactVectorIndex<TId> {
	return { ids: [], matrix: new Float32Array(0), dimensions: 0, count: 0 };
}

export function searchExactVectorIndex<TId>(
	_index: ExactVectorIndex<TId>,
	_query: readonly number[],
	_limit: number,
): ExactVectorSearchHit<TId>[] {
	return [];
}