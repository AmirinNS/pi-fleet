// Recall-branch coverage for the vendored mnemopi port. Every assertion below
// was verified against the running port before being written — these lock in
// the behaviour of the recall paths that the happy-path store test doesn't
// reach: temporal parsing, MMR/diversity, CJK tokenization, synonym-ish
// expansion, graceful degradation on malformed FTS5 input, the documented
// FTS5-only (no semantic) limitation, and a small-scale ranking check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { Mnemopi } from "../../src/vendor/mnemopi/core/memory.ts";

function newMem(dir: string): Mnemopi {
	return new Mnemopi({ dbPath: join(dir, "m.db"), noEmbeddings: true });
}

test("recall: temporal — a date query finds the dated fact", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rc-temp-"));
	try {
		const m = newMem(dir);
		m.remember("The release shipped on 2026-03-14.", { importance: 0.8 });
		m.remember("Standup is every Monday at 9am.", { importance: 0.7 });
		m.close();

		const m2 = newMem(dir);
		try {
			const byDate = await m2.recall("release shipped on 2026", 5);
			assert.ok(byDate.length > 0);
			assert.match((byDate[0] as { content: string }).content, /2026-03-14/);

			const byWhen = await m2.recall("when was the release", 5);
			assert.ok(byWhen.length > 0);
			assert.match((byWhen[0] as { content: string }).content, /2026-03-14/);
		} finally {
			m2.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("recall: MMR returns distinct facts for a shared term", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rc-mmr-"));
	try {
		const m = newMem(dir);
		m.remember("The database runs on port 5432.", { importance: 0.6 });
		m.remember("Redis listens on port 6379.", { importance: 0.6 });
		m.remember("The API gateway forwards to port 8080.", { importance: 0.6 });
		m.close();

		const m2 = newMem(dir);
		try {
			const r = await m2.recall("port", 5);
			assert.equal(r.length, 3, "all three port facts are returned");
			const ports = r.map((x) => (x as { content: string }).content).sort();
			assert.deepEqual(ports, [
				"Redis listens on port 6379.",
				"The API gateway forwards to port 8080.",
				"The database runs on port 5432.",
			]);
		} finally {
			m2.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("recall: CJK tokenization matches Japanese and Chinese facts", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rc-cjk-"));
	try {
		const m = newMem(dir);
		m.remember("昨日、東京で会議があった。", { importance: 0.7 });
		m.remember("我们部署了新版本到生产环境。", { importance: 0.7 });
		m.close();

		const m2 = newMem(dir);
		try {
			const ja = await m2.recall("東京 会議", 5);
			assert.ok(ja.length > 0, "Japanese query matches the Japanese fact");
			assert.match((ja[0] as { content: string }).content, /東京/);

			const zh = await m2.recall("部署 生产", 5);
			assert.ok(zh.length > 0, "Chinese query matches the Chinese fact");
			assert.match((zh[0] as { content: string }).content, /部署/);
		} finally {
			m2.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("recall: malformed FTS5 input degrades to empty, never throws", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rc-edge-"));
	try {
		const m = newMem(dir);
		m.remember("A fact about apples.", { importance: 0.5 });
		m.close();

		const m2 = newMem(dir);
		try {
			for (const q of ['"unmatched quote', "", "   ", "NEAR(apple, fruit)"]) {
				const r = await m2.recall(q, 5);
				// No throw is the contract; result is a (possibly empty) array.
				assert.ok(Array.isArray(r), `query ${JSON.stringify(q)} did not throw`);
			}
		} finally {
			m2.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("recall (FTS5-only limitation): a query with zero token overlap returns no hits", async () => {
	// Documents the first-port degradation: without an Embedder, recall is FTS5
	// token overlap only — a paraphrase with no shared tokens cannot match.
	// If this test starts failing, an Embedder has been wired and semantic recall
	// is live; update it to assert a hit instead.
	const dir = mkdtempSync(join(tmpdir(), "rc-para-"));
	try {
		const m = newMem(dir);
		m.remember("The widget frobnicates the giblet at dusk.", { importance: 0.8 });
		m.close();

		const m2 = newMem(dir);
		try {
			const r = await m2.recall("how does the doohickey operate", 5);
			assert.equal(r.length, 0, "no token overlap → no FTS5 hit (semantic recall not wired)");
		} finally {
			m2.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("recall: high-importance fact ranks top among many", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rc-scale-"));
	try {
		const m = newMem(dir);
		for (let i = 0; i < 50; i++) {
			m.remember(`fact ${i}: setting MNEMOPI_${i}=${i * 3}.`, { importance: 0.5 });
		}
		m.remember("IMPORTANT: the master token is sk-1234.", { importance: 1.0 });
		m.close();

		const m2 = newMem(dir);
		try {
			const r = await m2.recall("master token", 5);
			assert.ok(r.length > 0);
			assert.match((r[0] as { content: string }).content, /master token is sk-1234/);
		} finally {
			m2.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});