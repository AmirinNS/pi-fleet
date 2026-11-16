// Vendored from can1357/oh-my-pi packages/mnemopi/src/db.ts (MIT).
// Ported to Node: `bun:sqlite` → `better-sqlite3` via a compat wrapper.
// See THIRD_PARTY.md for the exact upstream commit and changes.

import BetterSqlite from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { dbPath } from "./config.ts";

/** SQLite bind value (matches bun:sqlite's SQLQueryBindings surface). */
export type SQLQueryBindings = string | number | bigint | boolean | null | Uint8Array;

/** Result of a `.run()` (mirrors better-sqlite3's Database.RunResult). */
export interface RunResult {
	changes: number;
	lastInsertRowid: number | bigint;
}

/** Loose view of the underlying better-sqlite3 statement for delegation. */
type LooseStatement = {
	all(...params: unknown[]): unknown[];
	get(...params: unknown[]): unknown;
	run(...params: unknown[]): RunResult;
	iterate(...params: unknown[]): IterableIterator<unknown>;
};

/**
 * Loosely-typed, disposable prepared-statement wrapper.
 *
 * The vendored mnemopi code calls `.all(...spreadArray)`, `.get(...params)`,
 * `.run(...params)` and `.iterate()` with 0..N args, and casts statements to
 * `Disposable` types. `better-sqlite3`'s generic `Statement<BindParameters>`
 * is too strict for that usage, so this wrapper widens the binding parameter
 * type to `SQLQueryBindings[]` and implements `[Symbol.dispose]` (a no-op —
 * better-sqlite3 statements are cached and need no explicit disposal).
 */
export class Statement {
	readonly #stmt: LooseStatement;
	constructor(stmt: LooseStatement) {
		this.#stmt = stmt;
	}
	all(...params: SQLQueryBindings[]): unknown[] {
		return this.#stmt.all(...params);
	}
	get(...params: SQLQueryBindings[]): unknown {
		return this.#stmt.get(...params);
	}
	run(...params: SQLQueryBindings[]): RunResult {
		return this.#stmt.run(...params);
	}
	iterate(...params: SQLQueryBindings[]): IterableIterator<unknown> {
		return this.#stmt.iterate(...params);
	}
	[Symbol.dispose](): void {
		// no-op: better-sqlite3 statements are cached on the Database.
	}
}

/**
 * bun:sqlite-compatible `Database` wrapper around `better-sqlite3`.
 *
 * Provides the `query` / `run` / `exec` / `prepare` / `transaction` /
 * `loadExtension` / `close` surface that the vendored mnemopi code expects,
 * so the rest of the port calls the same methods as the upstream Bun source.
 */
export class Database {
	readonly #db: BetterSqlite.Database;

	constructor(path: string, options?: { readonly?: boolean; fileMustExist?: boolean }) {
		this.#db = new BetterSqlite(path, options);
	}

	exec(sql: string): this {
		this.#db.exec(sql);
		return this;
	}

	prepare(sql: string): Statement {
		return new Statement(this.#db.prepare(sql) as unknown as LooseStatement);
	}

	/** bun:sqlite compat: returns a reusable prepared statement. */
	query(sql: string): Statement {
		return new Statement(this.#db.prepare(sql) as unknown as LooseStatement);
	}

	/**
	 * bun:sqlite compat: `db.run(sql, ...params)` or `db.run(sql, [params])`.
	 * Returns `{ changes, lastInsertRowid }`.
	 */
	run(sql: string, ...params: (SQLQueryBindings | SQLQueryBindings[])[]): RunResult {
		const stmt = this.#db.prepare(sql) as unknown as LooseStatement;
		const bindings =
			params.length === 1 && Array.isArray(params[0]) ? (params[0] as SQLQueryBindings[]) : params;
		return stmt.run(...bindings);
	}

	transaction<T extends (...params: never[]) => unknown>(fn: T): T {
		return this.#db.transaction(fn as never) as unknown as T;
	}

	loadExtension(path: string): this {
		this.#db.loadExtension(path);
		return this;
	}

	pragma(name: string): unknown {
		return this.#db.pragma(name);
	}

	close(): void {
		this.#db.close();
	}
}

export type SqlitePageSize = number | "os";

const MIN_SQLITE_PAGE_SIZE = 512;
const MAX_SQLITE_PAGE_SIZE = 65536;

function isValidPageSize(size: number): boolean {
	return (
		Number.isInteger(size) &&
		size >= MIN_SQLITE_PAGE_SIZE &&
		size <= MAX_SQLITE_PAGE_SIZE &&
		(size & (size - 1)) === 0
	);
}

function configuredPageSize(): SqlitePageSize | undefined {
	const raw = process.env.MNEMOPI_DB_PAGE_SIZE?.trim();
	if (!raw) return undefined;
	if (raw.toLowerCase() === "os") return "os";
	const size = Number(raw);
	return isValidPageSize(size) ? size : undefined;
}

function resolvePageSize(requested?: SqlitePageSize): number | undefined {
	const pageSize = requested ?? configuredPageSize();
	if (pageSize === "os") return undefined; // system-page detection dropped in the first port
	return pageSize !== undefined && isValidPageSize(pageSize) ? pageSize : undefined;
}

function applyPageSize(db: Database, path: DatabasePath, requested?: SqlitePageSize): void {
	if (path === ":memory:") return;
	const pageSize = resolvePageSize(requested);
	if (pageSize !== undefined) db.exec(`PRAGMA page_size=${pageSize}`);
}

export type DatabasePath = string | ":memory:";

export interface OpenDatabaseOptions {
	readonly create?: boolean;
	readonly readwrite?: boolean;
	readonly strict?: boolean;
	readonly loadExtension?: string | readonly string[];
	readonly pragmas?: boolean;
	readonly pageSize?: SqlitePageSize;
}

interface TxState {
	depth: number;
}

const TX_STATE = Symbol("mnemopi.txState");

type TxDatabase = Database & { [TX_STATE]?: TxState };

export function openDatabase(path: DatabasePath = dbPath(), options: OpenDatabaseOptions = {}): Database {
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path, { readonly: false, fileMustExist: false });
	if (options.pragmas !== false) enablePragmas(db, path, options.pageSize);
	else if (options.readwrite !== false) applyPageSize(db, path, options.pageSize);
	if (options.loadExtension !== undefined) loadExtensions(db, options.loadExtension);
	return db;
}

export function enablePragmas(db: Database, path?: DatabasePath, pageSize?: SqlitePageSize): void {
	db.exec("PRAGMA foreign_keys=ON");
	db.exec("PRAGMA busy_timeout=5000");
	if (path !== ":memory:") {
		applyPageSize(db, path ?? dbPath(), pageSize);
		db.exec("PRAGMA journal_mode=WAL");
	}
}

export function loadExtensions(db: Database, extensions: string | readonly string[]): void {
	if (typeof extensions === "string") {
		if (extensions) db.loadExtension(extensions);
		return;
	}
	for (const extension of extensions) {
		if (extension) db.loadExtension(extension);
	}
}

export function transaction<T>(db: Database, fn: () => T): T {
	const txDb = db as TxDatabase;
	let state = txDb[TX_STATE];
	if (state !== undefined && state.depth > 0) {
		state.depth++;
		try {
			return fn();
		} finally {
			state.depth--;
		}
	}

	state = { depth: 1 };
	txDb[TX_STATE] = state;
	db.exec("BEGIN DEFERRED");
	try {
		const result = fn();
		state.depth = 0;
		db.exec("COMMIT");
		return result;
	} catch (error) {
		state.depth = 0;
		try {
			db.exec("ROLLBACK");
		} catch {
			// Preserve the original error; rollback can fail if SQLite already closed the transaction.
		}
		throw error;
	} finally {
		delete txDb[TX_STATE];
	}
}

export const deferredTransaction = transaction;

export async function transactionAsync<T>(db: Database, fn: () => Promise<T>): Promise<T> {
	const txDb = db as TxDatabase;
	let state = txDb[TX_STATE];
	if (state !== undefined && state.depth > 0) {
		state.depth++;
		try {
			return await fn();
		} finally {
			state.depth--;
		}
	}

	state = { depth: 1 };
	txDb[TX_STATE] = state;
	db.exec("BEGIN DEFERRED");
	try {
		const result = await fn();
		state.depth = 0;
		db.exec("COMMIT");
		return result;
	} catch (error) {
		state.depth = 0;
		try {
			db.exec("ROLLBACK");
		} catch {
			// Preserve the original error; rollback can fail if SQLite already closed the transaction.
		}
		throw error;
	} finally {
		delete txDb[TX_STATE];
	}
}

export function closeQuietly(db: Database | undefined | null): void {
	if (db === undefined || db === null) return;
	try {
		db.close();
	} catch {
		// Best-effort cleanup.
	}
}