import OpenAI from 'openai';
import { modelSupportsTemperature } from 'src/common/util/llm-model.util';
import { ILlmProvider, LlmPreviewResult } from './llm-provider.interface';
import { describeProviderError } from './provider-error.util';

/**
 * OpenAI preview client.
 *
 * The SDK client is constructed inside `complete()` rather than in the
 * constructor. A lazily-created client that rejects outside a request's
 * try/catch has already taken this process down once (see
 * `voice-preview/providers/google-tts.provider.ts`), so nothing here is
 * constructed before there is a handler around it.
 */
export class OpenAiLlmProvider implements ILlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly temperature?: number,
  ) {}

  async complete(prompt: string, timeoutMs: number): Promise<LlmPreviewResult> {
    const startedAt = Date.now();
    try {
      const client = new OpenAI({ apiKey: this.apiKey, timeout: timeoutMs });

      const response = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        // Reasoning models reject any non-default temperature and 400. Same
        // rule the runtimes use, so a preview can't fail for a reason the real
        // call site would have avoided.
        ...(this.temperature !== undefined &&
        modelSupportsTemperature(this.model)
          ? { temperature: this.temperature }
          : {}),
        max_completion_tokens: 32,
      });

      return {
        ok: true,
        text: (response.choices[0]?.message?.content ?? '').trim(),
        latencyMs: Date.now() - startedAt,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
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
