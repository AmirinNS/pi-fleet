// Vendored from can1357/oh-my-pi (MIT License, Copyright (c) 2025 Mario Zechner,
// 2025-2026 Can Bölük). Upstream commit 3a8591a8af5b6d200088d12ca75a5517cb064fa8.
// Ported to Node/upstream pi — see THIRD_PARTY.md for the change list.

export type Env = Record<string, string | undefined>;

const TRUE_VALUES: Record<string, true> = { "1": true, true: true, yes: true, on: true };
const FALSE_VALUES: Record<string, true> = { "0": true, false: true, no: true, off: true };

export function envValue(name: string, env: Env = process.env): string | undefined {
	const value = env[name];
	return value === undefined ? undefined : value;
}

export function envString(name: string, defaultValue = "", env: Env = process.env): string {
	const value = env[name];
	return value === undefined ? defaultValue : value;
}

export function envOptionalString(name: string, env: Env = process.env): string | undefined {
	const value = env[name]?.trim();
	return value ? value : undefined;
}

export function envTruthy(name: string, env: Env = process.env): boolean {
	const value = env[name]?.trim().toLowerCase();
	return value !== undefined && TRUE_VALUES[value] === true;
}

export function envDisabled(name: string, env: Env = process.env): boolean {
	const value = env[name]?.trim().toLowerCase();
	return value !== undefined && FALSE_VALUES[value] === true;
}

export function envBool(name: string, defaultValue: boolean, env: Env = process.env): boolean {
	const value = env[name]?.trim().toLowerCase();
	if (!value) return defaultValue;
	if (TRUE_VALUES[value] === true) return true;
	if (FALSE_VALUES[value] === true) return false;
	return defaultValue;
}

export function envInt(name: string, defaultValue: number, env: Env = process.env): number {
	const raw = env[name]?.trim();
	if (!raw) return defaultValue;
	const value = Number.parseInt(raw, 10);
	return Number.isFinite(value) ? value : defaultValue;
}

export function envFloat(name: string, defaultValue: number, env: Env = process.env): number {
	const raw = env[name]?.trim();
	if (!raw) return defaultValue;
	const value = Number.parseFloat(raw);
	return Number.isFinite(value) ? value : defaultValue;
}

export function envOneOf<T extends string>(
	name: string,
	allowed: readonly T[],
	defaultValue: T,
	env: Env = process.env,
): T {
	const raw = env[name]?.trim().toLowerCase();
	if (!raw) return defaultValue;
	for (const value of allowed) {
		if (raw === value) return value;
	}
	return defaultValue;
}
