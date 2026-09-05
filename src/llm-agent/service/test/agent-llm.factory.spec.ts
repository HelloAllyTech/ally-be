import { BadRequestException } from '@nestjs/common';
import {
  AgentLlmProviderFactory,
  normaliseAgentProvider,
  providerForModel,
} from '../agent-llm.factory';

const config = (keys: Record<string, string | undefined>) =>
  ({
    anthropic: { apiKey: keys.anthropic },
    openai: { apiKey: keys.openai },
    gemini: { apiKey: keys.gemini },
  }) as any;

describe('providerForModel', () => {
  it('resolves catalogued models', () => {
    expect(providerForModel('claude-sonnet-4-6')).toBe('anthropic');
    expect(providerForModel('gpt-5-mini')).toBe('openai');
    expect(providerForModel('gemini-2.5-pro')).toBe('gemini');
  });

  it('resolves a model that is not in the catalog yet from its id', () => {
    // The point of the heuristic: a model added to the picker before this code
    // knows about it should not fail with "unsupported provider".
    expect(providerForModel('gemini-9.9-flash')).toBe('gemini');
    expect(providerForModel('o5-mini')).toBe('openai');
    expect(providerForModel('claude-opus-9-0')).toBe('anthropic');
  });

  it('returns undefined for a model nothing claims', () => {
    expect(providerForModel('llama-3-70b')).toBeUndefined();
    expect(providerForModel('')).toBeUndefined();
  });
});

describe('normaliseAgentProvider', () => {
  it('accepts "google" as a spelling of gemini', () => {
    // Every stored Gemini row spells it `google`; the alias lives in the
    // shared registry so this mirrors it rather than re-deciding it.
    expect(normaliseAgentProvider('google')).toBe('gemini');
    expect(normaliseAgentProvider('GEMINI')).toBe('gemini');
  });

  it('rejects runtimes ally-be cannot reach', () => {
    expect(normaliseAgentProvider('ollama')).toBeUndefined();
    expect(normaliseAgentProvider('vllm')).toBeUndefined();
    expect(normaliseAgentProvider(undefined)).toBeUndefined();
  });
});

describe('AgentLlmProviderFactory', () => {
  it('builds an adapter per provider', () => {
    const factory = new AgentLlmProviderFactory(
      config({ anthropic: 'a', openai: 'o', gemini: 'g' }),
    );

    expect(factory.create('anthropic', 'claude-sonnet-4-6').name).toBe(
      'anthropic',
    );
    expect(factory.create('openai', 'gpt-5').name).toBe('openai');
    expect(factory.create('google', 'gemini-2.5-pro').name).toBe('gemini');
  });

  it('says which kind of misconfiguration it is', () => {
    const factory = new AgentLlmProviderFactory(
      config({ anthropic: 'a', openai: undefined, gemini: undefined }),
    );

    // An environment missing a key is the common case and reads differently
    // from a provider that can never work here.
    expect(() => factory.create('openai', 'gpt-5')).toThrow(/no API key/);
    expect(() => factory.create('ollama', 'llama3')).toThrow(
      /cannot run an AI agent/,
    );
    expect(() => factory.create('anthropic', '  ')).toThrow(/no model/i);
    expect(() => factory.create('openai', 'gpt-5')).toThrow(
      BadRequestException,
    );
  });

  it('reports which providers this environment can run', () => {
    const factory = new AgentLlmProviderFactory(
      config({ anthropic: 'a', openai: undefined, gemini: 'g' }),
    );

    expect(factory.isConfigured('anthropic')).toBe(true);
    expect(factory.isConfigured('openai')).toBe(false);
    expect(factory.isConfigured('google')).toBe(true);
    expect(factory.isConfigured('vllm')).toBe(false);
  });
});
