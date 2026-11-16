// Vendored from can1357/oh-my-pi (MIT License, Copyright (c) 2025 Mario Zechner,
// 2025-2026 Can Bölük). Upstream commit 3a8591a8af5b6d200088d12ca75a5517cb064fa8.
// Ported to Node/upstream pi — see THIRD_PARTY.md for the change list.

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
	const length = a.length > b.length ? a.length : b.length;
	if (length === 0) {
		return 0;
	}

	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < length; i += 1) {
		const rawA = a[i] ?? 0;
		const rawB = b[i] ?? 0;
		const av = Number.isFinite(rawA) ? rawA : 0;
		const bv = Number.isFinite(rawB) ? rawB : 0;
		dot += av * bv;
		normA += av * av;
		normB += bv * bv;
	}
	if (normA === 0 || normB === 0) {
		return 0;
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
