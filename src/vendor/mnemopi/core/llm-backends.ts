// Stub: mnemopi core/llm-backends.ts (MIT source, deferred — host LLM
// completion is not wired in the first port).

export interface CompleteOptions {
	readonly maxTokens?: number;
	readonly temperature?: number;
	readonly timeout?: number;
	readonly provider?: string | null;
	readonly model?: string | null;
}

export interface LlmBackend {
	complete(prompt: string, opts?: CompleteOptions): Promise<string | null>;
}

export function setHostLlmBackend(_backend: LlmBackend | null | undefined): void {}

export function getHostLlmBackend(): LlmBackend | null {
	return null;
}

export function resetHostLlmBackendForTests(): void {}

export async function callHostLlm(_prompt: string, _opts: CompleteOptions = {}): Promise<string | null> {
	return null;
}

export class CallableLlmBackend implements LlmBackend {
	async complete(_prompt: string, _opts?: CompleteOptions): Promise<string | null> {
		return null;
	}
}