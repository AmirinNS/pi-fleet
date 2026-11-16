// Stub: mnemopi core/migrations/e6-triplestore-split.ts (MIT source, deferred).
// The triplestore split migration is only relevant when the legacy triples
// table exists; the first port drops the triples/KG subsystem entirely, so
// `hasPendingMigration` is always false and `migrate` is a no-op.

import type { Database } from "../../db.ts";

export function hasPendingMigration(_db: Database): boolean {
	return false;
}

export function migrate(_options: { dbPath: string; dryRun: boolean; backup: boolean; logFn: (msg: string) => void }): void {
	// no-op
}
