import { BadRequestException } from '@nestjs/common';
import {
  assertPreviewable,
  normaliseProvider,
  PreviewableLlmProvider,
} from '../preview-target.util';

/**
 * Replaces llm-provider.factory.spec.ts.
 *
 * The factory's job was two things: validate the target, then construct one of
 * three SDK clients. The construction moved to the shared `llm-agent` adapters
 * (it was the fourth copy of that plumbing in this repo). The validation stayed,
 * because its messages are read by an admin who just pressed Test and has to
 * work out what to do next — so the coverage stayed too.
 */
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

describe('assertPreviewable', () => {
  it('returns the canonical provider for a valid target', () => {
    expect(assertPreviewable('google', 'gemini-2.5-pro')).toBe(
      PreviewableLlmProvider.GEMINI,
    );
    expect(assertPreviewable('OpenAI', 'gpt-4o-mini')).toBe(
      PreviewableLlmProvider.OPENAI,
    );
  });

  // ollama/vllm are valid in LLM_CONFIG_SCHEMA but run inside the voice
  // runtime, so ally-be has nothing to call. Say so plainly instead of
  // reporting a generic failure the admin can't act on.
  it.each(['ollama', 'vllm'])('explains why %s cannot be previewed', (name) => {
    expect(() => assertPreviewable(name, 'llama3')).toThrow(
      /cannot be previewed from here/,
    );
  });

  it('rejects an unknown provider', () => {
    expect(() => assertPreviewable('cohere', 'command-r')).toThrow(
      BadRequestException,
    );
  });

  it('refuses a config with no model rather than guessing one', () => {
    expect(() => assertPreviewable('openai', '')).toThrow(/no model set/);
    expect(() => assertPreviewable('openai', '   ')).toThrow(/no model set/);
  });

  it('checks the local-only case before the unknown-provider case', () => {
    // Order matters: 'ollama' is also not previewable, so a generic "unsupported
    // provider" would be technically true and useless. The specific message has
    // to win.
    expect(() => assertPreviewable('ollama', 'llama3')).toThrow(
      /runs inside the voice runtime/,
    );
  });
});
