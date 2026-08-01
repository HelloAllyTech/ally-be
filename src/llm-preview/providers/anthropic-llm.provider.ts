import Anthropic from '@anthropic-ai/sdk';
import { ILlmProvider, LlmPreviewResult } from './llm-provider.interface';
import { describeProviderError } from './provider-error.util';

/**
 * Anthropic preview client.
 *
 * Note this provider is `ally-be`-only at runtime (autofill / copilot);
 * ai-learn has no Anthropic branch. A preview succeeding here therefore does
 * NOT mean the model can serve a voice session — see the provider×runtime
 * matrix in the ADR. The picker is what must enforce that; this client simply
 * reports whether the credential and model work.
 *
 * Client construction is inside `complete()` — see `openai-llm.provider.ts`.
 */
export class AnthropicLlmProvider implements ILlmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly temperature?: number,
  ) {}

  async complete(prompt: string, timeoutMs: number): Promise<LlmPreviewResult> {
    const startedAt = Date.now();
    try {
      const client = new Anthropic({ apiKey: this.apiKey, timeout: timeoutMs });

      const response = await client.messages.create({
        model: this.model,
        max_tokens: 32,
        messages: [{ role: 'user', content: prompt }],
        ...(this.temperature !== undefined
          ? { temperature: this.temperature }
          : {}),
      });

      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();

      return {
        ok: true,
        text,
        latencyMs: Date.now() - startedAt,
        promptTokens: response.usage?.input_tokens,
        completionTokens: response.usage?.output_tokens,
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
