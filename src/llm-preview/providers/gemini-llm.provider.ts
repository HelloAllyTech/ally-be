import { GoogleGenAI } from '@google/genai';
import { ILlmProvider, LlmPreviewResult } from './llm-provider.interface';
import { describeProviderError } from './provider-error.util';

/**
 * Gemini preview client, using the same `@google/genai` SDK as the coaching
 * chat so a preview exercises the path the product actually uses.
 *
 * Client construction is inside `complete()` — see the note in
 * `openai-llm.provider.ts`.
 */
export class GeminiLlmProvider implements ILlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly temperature?: number,
  ) {}

  async complete(prompt: string, timeoutMs: number): Promise<LlmPreviewResult> {
    const startedAt = Date.now();
    try {
      const client = new GoogleGenAI({ apiKey: this.apiKey });

      // The SDK has no per-call timeout option, so race it. Without this a
      // hung provider would hold the request open until the gateway gives up.
      const response = await withTimeout(
        client.models.generateContent({
          model: this.model,
          contents: prompt,
          config: {
            maxOutputTokens: 32,
            ...(this.temperature !== undefined
              ? { temperature: this.temperature }
              : {}),
          },
        }),
        timeoutMs,
      );

      const usage = (response as any)?.usageMetadata;
      return {
        ok: true,
        text: (response.text ?? '').trim(),
        latencyMs: Date.now() - startedAt,
        promptTokens: usage?.promptTokenCount,
        completionTokens: usage?.candidatesTokenCount,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        text: '',
        latencyMs: Date.now() - startedAt,
        error: describeProviderError(error),
      };
    }
  }
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer),
  ) as Promise<T>;
};
