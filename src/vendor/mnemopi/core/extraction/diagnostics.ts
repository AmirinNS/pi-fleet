// Stub: mnemopi core/extraction/diagnostics.ts (MIT source, deferred — LLM
// extraction diagnostics are not needed without LLM extraction).

export const EXTRACTION_TIERS = ["host", "remote", "local", "cloud", "wrapper"] as const;
export type ExtractionTier = (typeof EXTRACTION_TIERS)[number];

export interface ErrorSample {
	readonly tier: ExtractionTier;
	readonly message: string;
	readonly timestamp: string;
}

export interface TierStatsSnapshot {
	readonly attempts: number;
	readonly failures: number;
	readonly lastError: ErrorSample | null;
}

export interface ExtractionStatsSnapshot {
	readonly tiers: Record<ExtractionTier, TierStatsSnapshot>;
	readonly totalAttempts: number;
	readonly totalFailures: number;
}

export function safeForLog(value: unknown): string {
	return String(value);
}

export class ExtractionDiagnostics {
	recordAttempt(_tier: ExtractionTier): void {}
	recordSuccess(_tier: ExtractionTier, _count: number): void {}
	recordCall(_result: { succeeded: boolean; allEmpty?: boolean }): void {}
	recordNoOutput(_tier: ExtractionTier): void {}
	recordFailure(_tier: ExtractionTier, _error: unknown, _reason: string): void {}
	snapshot(): ExtractionStatsSnapshot {
		return { tiers: {} as Record<ExtractionTier, TierStatsSnapshot>, totalAttempts: 0, totalFailures: 0 };
	}
	reset(): void {}
}

export function getDiagnostics(): ExtractionDiagnostics {
	return new ExtractionDiagnostics();
}

export function getExtractionStats(): ExtractionStatsSnapshot {
	return { tiers: {} as Record<ExtractionTier, TierStatsSnapshot>, totalAttempts: 0, totalFailures: 0 };
}

export function resetExtractionStats(): void {}
