import {
  claudeModelAcceptsForcedToolChoice,
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

  describe('claudeModelAcceptsForcedToolChoice', () => {
    it.each([
      // Known to accept a forced tool_choice.
      ['claude-3-haiku-20240307', true],
      ['claude-3-5-sonnet-20241022', true],
      ['claude-opus-4-20250514', true],
      ['claude-opus-4-1', true],
      ['claude-sonnet-4-5-20250929', true],
      ['claude-sonnet-4-6', true],
      ['claude-haiku-4-5', true],
      ['claude-opus-4-8', true],
      ['claude-opus-5', true],
      ['claude-sonnet-5', true],
      ['claude-fable-5', true],
      ['claude-mythos-5', true],
      ['claude-haiku-5-5', true],
      ['  Claude-Sonnet-4-6 ', true],
      // Reject one with a 400.
      ['claude-opus-5-5', false],
      ['claude-sonnet-5-5', false],
      ['claude-fable-5-1', false],
      ['claude-mythos-5-1', false],
      // Unrecognised: not known to accept, so treated as rejecting.
      ['claude-opus-6', false],
      ['claude-mythos-preview', false],
      ['gpt-4o', false],
      ['', false],
      [undefined, false],
    ])('claudeModelAcceptsForcedToolChoice(%s) = %s', (model, expected) => {
      expect(
        claudeModelAcceptsForcedToolChoice(model as string | undefined),
      ).toBe(expected);
    });
  });

  describe('modelSupportsTemperature', () => {
    it.each([
      ['gpt-4o', true],
      ['gpt-4.1', true],
      ['gemini-2.5-pro', true],
      ['gemini-2.5-flash', true],
      ['gemini-3-pro-preview', false],
      ['gemini-3.1-pro-preview', false],
      ['models/gemini-3-flash', false],
      ['gemini-flash-latest', false],
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

    describe('Claude: an allowlist of the models that accept one', () => {
      it.each([
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-7-sonnet-latest',
        'claude-3-opus-20240229',
        'claude-opus-4-20250514',
        'claude-sonnet-4-20250514',
        'claude-opus-4-0',
        'claude-opus-4-1',
        'claude-opus-4-1-20250805',
        'claude-sonnet-4-5',
        'claude-sonnet-4-5-20250929',
        'claude-opus-4-5-20251101',
        'claude-opus-4-6',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
        'claude-haiku-4-5-20251001',
        '  Claude-Sonnet-4-6 ',
      ])('%s accepts a temperature', (model) => {
        expect(modelSupportsTemperature(model)).toBe(true);
      });

      it.each([
        // Removed outright: any temperature is a 400.
        'claude-opus-4-7',
        'claude-opus-4-8',
        'claude-opus-5',
        'claude-opus-5-5',
        'claude-sonnet-5',
        'claude-fable-5',
        'claude-fable-5-1',
        'claude-mythos-5-1',
        // Only the default is accepted, so a custom value is a 400.
        'claude-sonnet-5-5',
        'claude-haiku-5-5',
        // Unrecognised — including whatever ships next — takes the safe side.
        'claude-opus-6',
        'claude-haiku-4-6',
        'claude-sonnet-4-6-preview',
        'claude-2.1',
      ])('%s rejects one', (model) => {
        expect(modelSupportsTemperature(model)).toBe(false);
      });
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
      expect(
        resolveTemperature('claude-sonnet-5-5', 0, undefined, undefined),
      ).toBeUndefined();
    });
  });
});
