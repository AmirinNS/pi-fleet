// B2: store round-trip on Node (no Bun). Opens a temp DB via the ported
// store, remembers one fact, recalls it back. FTS5-only recall (no embeddings).

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { Mnemopi } from "../../src/vendor/mnemopi/core/memory.ts";

test("store round-trip: remember → recall (FTS5-only, in-memory)", async () => {
	const mem = new Mnemopi({ dbPath: ":memory:", noEmbeddings: true });
	try {
		const id = mem.remember("The deployment target is stable-cluster.", {
			source: "notes",
			importance: 0.8,
		});
		assert.ok(typeof id === "string" && id.length > 0, "remember returns a string id");

		const results = await mem.recall("deployment target", 5);
		assert.ok(results.length > 0, "recall returns at least one hit");
		const top = results[0] as { content?: string };
		assert.ok(
			(top?.content ?? "").includes("stable-cluster"),
			"top result content matches the stored fact",
		);
	} finally {
		mem.close();
	}
});

test("store round-trip: file-backed DB persists a remembered fact", async () => {
	const dir = mkdtempSync(join(tmpdir(), "mnemopi-port-"));
	const dbPath = join(dir, "mnemopi.db");
	try {
		const mem = new Mnemopi({ dbPath, noEmbeddings: true });
		mem.remember("pi-fleet uses better-sqlite3 for the first port.", {
			source: "notes",
			importance: 0.9,
		});
		mem.close();

		// Reopen and recall — the fact must survive the reopen.
		const mem2 = new Mnemopi({ dbPath, noEmbeddings: true });
		try {
			const results = await mem2.recall("better-sqlite3", 5);
			assert.ok(results.length > 0, "recalled the persisted fact after reopen");
			const top = results[0] as { content?: string };
			assert.ok((top?.content ?? "").includes("better-sqlite3"));
		} finally {
			mem2.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});