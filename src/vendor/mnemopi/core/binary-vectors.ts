// Stub: mnemopi core/binary-vectors.ts (MIT source, deferred — int8/bit vector
// quantization is only reached on the sqlite-vec path, which is unavailable in
// the first port). Re-exports `cosineSimilarity` from the pure-JS vector-math
// module so `helpers.ts`'s re-export compiles; the quantization helpers are
// no-ops.

import { cosineSimilarity } from "./vector-math.ts";

export { cosineSimilarity };

export function hammingDistance(_a: unknown, _b: unknown): number {
	return 0;
}

export function informationTheoreticScore(_a: unknown, _b: unknown): number {
	return 0;
}

export function maximallyInformativeBinarization(_values: readonly number[]): Uint8Array {
	return new Uint8Array(0);
}

export function quantizeInt8(_values: readonly number[]): Int8Array {
	return new Int8Array(0);
}