import { BadRequestException } from '@nestjs/common';
import { AnthropicLlmProvider } from '../anthropic-llm.provider';
import { GeminiLlmProvider } from '../gemini-llm.provider';
import {
  LlmProviderFactory,
  normaliseProvider,
  PreviewableLlmProvider,
} from '../llm-provider.factory';
import { OpenAiLlmProvider } from '../openai-llm.provider';

const configService = {
  openai: { apiKey: 'openai-key' },
  gemini: { apiKey: 'gemini-key' },
  anthropic: { apiKey: 'anthropic-key' },
} as any;

const factory = () => new LlmProviderFactory(configService);

describe('normaliseProvider', () => {
  // LLM_CONFIG_SCHEMA stores 'google'; LLM_MODEL_REGISTRY says 'gemini'. Both
  // mean the same provider until that defect is reconciled.
  it.each(['google', 'gemini', 'GOOGLE', ' Gemini '])(
    'maps %p to gemini',
    (input) => {
      expect(normaliseProvider(input)).toBe(PreviewableLlmProvider.GEMINI);
    },
  );

  it('maps openai and anthropic case-insensitively', () => {
    expect(normaliseProvider('OpenAI')).toBe(PreviewableLlmProvider.OPENAI);
    expect(normaliseProvider('ANTHROPIC')).toBe(
      PreviewableLlmProvider.ANTHROPIC,
    );
  });

  it('returns undefined for anything else', () => {
    expect(normaliseProvider('cohere')).toBeUndefined();
    expect(normaliseProvider(undefined)).toBeUndefined();
  });
});

describe('LlmProviderFactory', () => {
  it('builds the right client per provider', () => {
    expect(factory().createProvider('openai', 'gpt-4o-mini')).toBeInstanceOf(
      OpenAiLlmProvider,
    );
    expect(factory().createProvider('google', 'gemini-2.5-pro')).toBeInstanceOf(
      GeminiLlmProvider,
    );
    expect(
      factory().createProvider('anthropic', 'claude-haiku-4-5'),
    ).toBeInstanceOf(AnthropicLlmProvider);
  });

  // ollama/vllm are valid in LLM_CONFIG_SCHEMA but run inside the voice
  // runtime, so ally-be has nothing to call. Say so plainly instead of
  // reporting a generic failure the admin can't act on.
  it.each(['ollama', 'vllm'])('explains why %s cannot be previewed', (name) => {
    expect(() => factory().createProvider(name, 'llama3')).toThrow(
      /cannot be previewed from here/,
    );
  });

  it('rejects an unknown provider', () => {
    expect(() => factory().createProvider('cohere', 'command-r')).toThrow(
      BadRequestException,
    );
  });

  it('refuses a config with no model rather than guessing one', () => {
    expect(() => factory().createProvider('openai', '')).toThrow(
      /no model set/,
    );
    expect(() => factory().createProvider('openai', '   ')).toThrow(
      /no model set/,
    );
  });

  it('reports a provider whose key is missing on this environment', () => {
    const bare = new LlmProviderFactory({
      openai: {},
      gemini: {},
      anthropic: {},
    } as any);

    expect(() => bare.createProvider('openai', 'gpt-4o-mini')).toThrow(
      /not configured on this environment/,
    );
  });
});
