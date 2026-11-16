// Stub: mnemopi core/local-llm.ts (MIT source, deferred — local/remote LLM
// completion is not wired in the first port). Exports the names `extraction.ts`
// imports so it compiles; all completion paths return null.

export interface RemoteLlmOptions {
	readonly baseUrl?: string;
	readonly apiKey?: string;
	readonly model?: string;
	readonly maxTokens?: number;
	readonly temperature?: number;
}

export const DEFAULT_MODEL_REPO = "";
export const DEFAULT_MODEL_FILE = "";

export function buildPrompt(memories: readonly string[], _source = ""): string {
	return memories.join("\n");
}

export async function callConfiguredCompletion(_prompt: string, _idx = 0, _opts?: { maxTokens?: number }): Promise<string | null> {
	return null;
}

export function buildHostPrompt(memories: readonly string[], _source = ""): string {
	return memories.join("\n");
}

export function configuredLlmWillHandleCall(): boolean {
	return false;
}

export function cleanOutput(text: string): string {
	return text;
}

export function chunkMemoriesByBudget(memories: readonly string[], _source = ""): string[][] {
	return memories.length > 0 ? [memories.slice()] : [];
}

export function llmAvailable(): boolean {
	return false;
}

export async function callRemoteLlm(_prompt: string, _idx = 0, _opts: RemoteLlmOptions = {}): Promise<string | null> {
	return null;
}

export function localGgufAvailable(): false {
	return false;
}

export async function callLocalLlm(_prompt: string): Promise<string | null> {
	return null;
}

export async function summarizeMemories(_memories: readonly string[], _source = ""): Promise<string | null> {
	return null;
}

export async function complete(_prompt: string): Promise<string | null> {
	return null;
}
