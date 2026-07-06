import {
  isOpenAiModel,
  isGeminiModel,
  modelSupportsTemperature,
  resolveChatProviderModel,
  resolveTemperature,
} from '../llm-model.util';

describe('llm-model.util', () => {
  describe('isOpenAiModel', () => {
    it.each([
      ['gpt-4o', true],
      ['gpt-4.1-mini', true],
      ['o3-mini', true],
      ['gemini-2.5-pro', false],
      ['claude-sonnet-4-6', false],
      [undefined, false],
    ])('isOpenAiModel(%s) = %s', (model, expected) => {
      expect(isOpenAiModel(model as string | undefined)).toBe(expected);
    });
  });

  describe('modelSupportsTemperature', () => {
    it.each([
      ['gpt-4o', true],
      ['gpt-4.1', true],
      ['gemini-2.5-pro', true],
      ['gpt-5', false],
      ['gpt-5-mini', false],
      ['o1', false],
      ['o4-mini', false],
      [undefined, true],
    ])('modelSupportsTemperature(%s) = %s', (model, expected) => {
      expect(modelSupportsTemperature(model as string | undefined)).toBe(
        expected,
      );
    });
  });

  describe('isGeminiModel', () => {
    it.each([
      ['gemini-2.5-pro', true],
      ['gemini-2.5-flash', true],
      ['gpt-4o', false],
      ['claude-sonnet-4-6', false],
      [undefined, false],
    ])('isGeminiModel(%s) = %s', (model, expected) => {
      expect(isGeminiModel(model as string | undefined)).toBe(expected);
    });
  });

  describe('resolveChatProviderModel (OpenAI + Gemini runnable)', () => {
    const DEFAULT = 'gpt-4o-mini';
    it('explicit openai provider + model', () => {
      expect(resolveChatProviderModel('openai', 'gpt-4o', DEFAULT)).toEqual({
        providerType: 'openai',
        model: 'gpt-4o',
      });
    });
    it('explicit gemini provider + model', () => {
      expect(
        resolveChatProviderModel('gemini', 'gemini-2.5-flash', DEFAULT),
      ).toEqual({ providerType: 'gemini', model: 'gemini-2.5-flash' });
    });
    it('infers gemini from model name when provider absent', () => {
      expect(
        resolveChatProviderModel(undefined, 'gemini-2.5-pro', DEFAULT),
      ).toEqual({ providerType: 'gemini', model: 'gemini-2.5-pro' });
    });
    it('infers openai from model name when provider absent', () => {
      expect(resolveChatProviderModel(undefined, 'gpt-4.1', DEFAULT)).toEqual({
        providerType: 'openai',
        model: 'gpt-4.1',
      });
    });
    it('falls back to default OpenAI model when no override', () => {
      expect(resolveChatProviderModel(undefined, undefined, DEFAULT)).toEqual({
        providerType: 'openai',
        model: DEFAULT,
      });
    });
    it('falls back to default for an unrunnable provider (e.g. anthropic)', () => {
      expect(
        resolveChatProviderModel('anthropic', 'claude-sonnet-4-6', DEFAULT),
      ).toEqual({ providerType: 'openai', model: DEFAULT });
    });
  });

  describe('resolveTemperature (precedence: code -> prompt -> override)', () => {
    it('override (simulation) wins over prompt and code', () => {
      expect(resolveTemperature('gpt-4o', 0.7, 0.4, 0.9)).toBe(0.9);
    });
    it('prompt-level used when no override', () => {
      expect(resolveTemperature('gpt-4o', 0.7, 0.4, undefined)).toBe(0.4);
    });
    it('code default when neither prompt nor override', () => {
      expect(resolveTemperature('gpt-4o', 0.7, undefined, undefined)).toBe(0.7);
    });
    it('omitted (undefined) when the model rejects a custom temperature', () => {
      expect(resolveTemperature('gpt-5', 0.7, 0.4, 0.9)).toBeUndefined();
    });
  });
});
