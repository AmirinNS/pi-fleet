// Database wrapper coverage for the ported `db.ts`. Verifies the
// bun:sqlite-compatible surface (`query`, `run`, `prepare`, `exec`,
// `transaction`, `loadExtension`) over `better-sqlite3`, including the two
// `run()` param shapes the vendored code uses (spread vs. single array) and
// transaction commit/rollback.

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { openDatabase, transaction, type Statement } from "../../src/vendor/mnemopi/db.ts";

test("Database: exec + prepare().get() round-trip", () => {
	const dir = mkdtempSync(join(tmpdir(), "db-1-"));
	try {
		const db = openDatabase(join(dir, "a.db"));
		db.exec("CREATE TABLE t(x INTEGER, y TEXT)");
		db.run("INSERT INTO t(x, y) VALUES (?, ?)", [1, "a"]);
		db.run("INSERT INTO t(x, y) VALUES (?, ?)", 2, "b"); // spread form
		const row = db.prepare("SELECT y FROM t WHERE x = ?").get(2) as { y: string } | undefined;
		assert.equal(row?.y, "b");
		const all = db.query("SELECT x FROM t ORDER BY x").all() as Array<{ x: number }>;
		assert.deepEqual(all.map((r) => r.x), [1, 2]);
		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("Database.run: array-param and spread-param shapes both insert", () => {
	const dir = mkdtempSync(join(tmpdir(), "db-2-"));
	try {
		const db = openDatabase(join(dir, "b.db"));
		db.exec("CREATE TABLE t(v INTEGER)");
		db.run("INSERT INTO t(v) VALUES (?)", [42]); // single array arg
		db.run("INSERT INTO t(v) VALUES (?)", 7); // single scalar arg (spread)
		const sum = db.prepare("SELECT SUM(v) AS s FROM t").get() as { s: number | null };
		assert.equal(sum.s, 49);
		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("standalone transaction(): commits on success, rolls back on error", () => {
	const dir = mkdtempSync(join(tmpdir(), "db-3-"));
	try {
		const db = openDatabase(join(dir, "c.db"));
		db.exec("CREATE TABLE t(v INTEGER)");

		transaction(db, () => {
			db.run("INSERT INTO t(v) VALUES (?)", [1]);
		});
		assert.equal((db.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number }).c, 1);

		assert.throws(
			() =>
				transaction(db, () => {
					db.run("INSERT INTO t(v) VALUES (?)", [2]);
					throw new Error("boom");
				}),
			/boom/,
		);
		// The second insert must have been rolled back.
		assert.equal((db.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number }).c, 1);
		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("Database.transaction(): method form returns a callable that commits", () => {
	const dir = mkdtempSync(join(tmpdir(), "db-4-"));
	try {
		const db = openDatabase(join(dir, "d.db"));
		db.exec("CREATE TABLE t(x INTEGER)");
		const tx = db.transaction(() => {
			db.run("INSERT INTO t(x) VALUES (?)", [1]);
			db.run("INSERT INTO t(x) VALUES (?)", [2]);
			return 2;
		});
		const n = tx();
		assert.equal(n, 2, "transaction returns the fn result");
		assert.equal((db.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number }).c, 2);
		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("Statement implements [Symbol.dispose] (Disposable) — no-op, no throw", () => {
	const dir = mkdtempSync(join(tmpdir(), "db-5-"));
	try {
		const db = openDatabase(join(dir, "e.db"));
		db.exec("CREATE TABLE t(x INTEGER)");
		const stmt = db.prepare("SELECT 1 AS v") as Statement;
		assert.equal(typeof stmt[Symbol.dispose], "function");
		// Calling dispose must not throw and must not close the underlying DB.
		stmt[Symbol.dispose]();
		const row = db.prepare("SELECT 1 AS v").get() as { v: number };
		assert.equal(row.v, 1, "DB still usable after statement dispose");
		db.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});