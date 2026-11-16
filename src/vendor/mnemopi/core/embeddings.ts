// Stub: mnemopi core/embeddings.ts (MIT source, deferred in the first port).
//
// Real embeddings (ONNX via fastembed, or OpenAI-compatible remote) are the
// heaviest coupling (forked pi-ai auth, pi-natives, fastembed, Bun.file/Glob).
// They are deferred behind an `Embedder` interface; this no-op stub makes
// `embeddingsDisabled()` true, `embed()`/`embedQuery()` return null, so:
//   - `scheduleEmbedding` stores no vectors (helpers.ts `runEmbedding` returns
//     early when `embed()` yields null);
//   - `recall()`'s `embedQuery()` yields null → `queryEmbedding` is null → the
//     dense/vec score is 0 for every candidate → ranking is FTS5 + importance
//     only (the documented first-port degradation).

export type Vector = Float32Array;
export type EmbeddingMatrix = Vector[];

/** Always disabled in the first port. */
export function embeddingsDisabled(): boolean {
	return true;
}

/** Sentinel model name; no embeddings are produced. */
export function currentEmbeddingModel(): string {
	return "none";
}

export async function embed(_texts: readonly string[]): Promise<EmbeddingMatrix | null> {
	return null;
}

export async function embedQuery(_text: string): Promise<Vector | null> {
	return null;
}

export async function available(): Promise<boolean> {
	return false;
}

export function availableApi(): boolean {
	return false;
}

export function isApiModel(_modelName: string): boolean {
	return false;
}

export function embeddingDimFor(_modelName: string): number {
	return 0;
}