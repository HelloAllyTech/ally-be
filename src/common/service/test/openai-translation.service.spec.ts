import { OpenAITranslationsService } from '../openai-translation.service';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';

// Every completion goes through the provider factory; tests swap the
// provider's getCompletion via `completionMock`.
let completionMock: jest.Mock = jest.fn();
const getProvider = jest.fn(() => ({
  getCompletion: (...args: unknown[]) => completionMock(...args),
}));

// Minimal AppConfigService stub
const baseConfig: Partial<AppConfigService> = {
  openai: {
    apiKey: 'test-key',
    translationModel: 'gpt-4o-mini',
  } as any,
  gemini: { apiKey: 'gemini-key' } as any,
  translation: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    maxTokens: 16384,
    thinkingBudget: 0,
  },
} as any;

function createService(
  promptShared: Partial<PromptSharedService>,
  cfg?: Partial<AppConfigService>,
) {
  const promptSharedWithDefaults: Partial<PromptSharedService> = {
    getPromptByCode: jest.fn().mockResolvedValue(null),
    ...promptShared,
  };

  return new OpenAITranslationsService(
    (cfg ?? baseConfig) as AppConfigService,
    promptSharedWithDefaults as PromptSharedService,
    { record: jest.fn() } as any,
    { getProvider } as any,
  );
}

describe('OpenAITranslationsService', () => {
  const sourceObject = { title: 'Hello', nested: { a: 1 } };
  const scenarioContext = {
    title: 'Character',
    tone: 'Calm',
    age: '30',
  } as any;

  describe('isConfigured', () => {
    it('true when apiKey and model exist', () => {
      const service = createService({});
      expect(service.isConfigured()).toBe(true);
    });
    it('false when the Gemini key is missing', () => {
      const cfg = { ...baseConfig, gemini: { apiKey: '' } } as any;
      const service = createService({}, cfg);
      expect(service.isConfigured()).toBe(false);
    });
    it('checks the OpenAI key when the provider is openai', () => {
      const cfg = {
        ...baseConfig,
        gemini: { apiKey: '' },
        translation: { provider: 'openai', model: 'gpt-4o-mini' },
      } as any;
      expect(createService({}, cfg).isConfigured()).toBe(true);
      cfg.openai = { apiKey: '' };
      expect(createService({}, cfg).isConfigured()).toBe(false);
    });
  });

  describe('translation engine', () => {
    it('routes JSON translations to the configured provider and model', async () => {
      completionMock = jest
        .fn()
        .mockResolvedValue(JSON.stringify({ title: 'नमस्ते' }));
      getProvider.mockClear();
      const service = createService({});

      await (service as any).fetchTranslations(
        [JSON.stringify({ title: 'Hello' })],
        'hi',
        'sys',
        '',
      );

      expect(getProvider).toHaveBeenCalledWith('gemini');
      expect(completionMock).toHaveBeenCalledWith(
        [{ role: 'system', content: 'sys' }],
        {
          model: 'gemini-2.5-flash',
          maxTokens: 16384,
          thinkingBudget: 0,
          temperature: 0.62,
          responseFormat: 'json',
        },
        expect.any(Function),
      );
    });

    it('records usage under the provider that ran', async () => {
      const record = jest.fn();
      completionMock = jest.fn(async (_m, _c, onUsage) => {
        onUsage({ promptTokens: 10, completionTokens: 5 });
        return 'नमस्ते';
      });
      const service = new OpenAITranslationsService(
        baseConfig as AppConfigService,
        {
          getPromptByCode: jest.fn().mockResolvedValue('{{text}}'),
        } as any,
        { record } as any,
        { getProvider } as any,
      );

      await service.translateText('Hello', 'hi');

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        }),
      );
    });
  });

  describe('resolveBaseLanguageCode', () => {
    it('extracts base code', () => {
      const service = createService({});
      const fn = (service as any).resolveBaseLanguageCode.bind(service);
      expect(fn('hi-IN')).toBe('hi');
      expect(fn('TA-IN')).toBe('ta');
      expect(fn('pa')).toBe('pa');
    });
  });

  describe('getTemperatureForLanguage', () => {
    it('returns mapped temperatures for supported languages', () => {
      const service = createService({});
      const fn = (service as any).getTemperatureForLanguage.bind(service);
      expect(fn('hi-IN')).toBe(0.62); // Hindi
      expect(fn('pa')).toBe(0.64); // Punjabi
      expect(fn('ta-IN')).toBe(0.63); // Tamil
      expect(fn('ml')).toBe(0.64); // Malayalam
      expect(fn('te')).toBe(0.61); // Telugu
      expect(fn('kn')).toBe(0.61); // Kannada
      expect(fn('mr')).toBe(0.6); // Marathi
      expect(fn('bn')).toBe(0.6); // Bengali
      expect(fn('gu')).toBe(0.6); // Gujarati
      expect(fn('or')).toBe(0.61); // Odia
    });

    it('returns default temperature for unsupported languages', () => {
      const service = createService({});
      const fn = (service as any).getTemperatureForLanguage.bind(service);
      expect(fn('xx')).toBe(0.61);
      expect(fn('ZZ-ZZ')).toBe(0.61);
    });
  });

  describe('fetchTranslations', () => {
    it('returns parsed JSON on success', async () => {
      const createMock = jest
        .fn()
        .mockResolvedValue(JSON.stringify({ title: 'नमस्ते' }));
      completionMock = createMock;
      const service = createService({});
      const result = await (service as any).fetchTranslations(
        [JSON.stringify(sourceObject)],
        'hi',
        'sys',
        'usr',
      );
      expect(Array.isArray(result)).toBe(true);
      expect(JSON.parse(result[0]).title).toBe('नमस्ते');
    });
    it('falls back to original on parse error', async () => {
      const createMock = jest.fn().mockResolvedValue('not-json');
      completionMock = createMock;
      const service = createService({});
      const original = JSON.stringify(sourceObject);
      const result = await (service as any).fetchTranslations(
        [original],
        'hi',
        'sys',
        'usr',
      );
      expect(result).toEqual([original]);
    });
    it('falls back on empty content and on API error', async () => {
      const createMock = jest
        .fn()
        .mockResolvedValueOnce('')
        .mockRejectedValueOnce(new Error('boom'));
      completionMock = createMock;
      const service = createService({});
      const original = JSON.stringify(sourceObject);
      let result = await (service as any).fetchTranslations(
        [original],
        'hi',
        'sys',
        'usr',
      );
      expect(result).toEqual([original]);

      result = await (service as any).fetchTranslations(
        [original],
        'hi',
        'sys',
        'usr',
      );
      expect(result).toEqual([original]);
    });

    it('falls back to original when output leaks HTML entities', async () => {
      const createMock = jest
        .fn()
        .mockResolvedValue(
          JSON.stringify({ message: 'Great job, &lt;user&gt;!' }),
        );
      completionMock = createMock;
      const service = createService({});
      const original = JSON.stringify({ message: 'Great job, <user_name>!' });
      const result = await (service as any).fetchTranslations(
        [original],
        'hi',
        'sys',
        'usr',
      );
      expect(result).toEqual([original]);
    });

    it('falls back to original when a source placeholder is dropped', async () => {
      const createMock = jest
        .fn()
        .mockResolvedValue(JSON.stringify({ message: 'शाबाश!' }));
      completionMock = createMock;
      const service = createService({});
      const original = JSON.stringify({ message: 'Great job, <user_name>!' });
      const result = await (service as any).fetchTranslations(
        [original],
        'hi',
        'sys',
        'usr',
      );
      expect(result).toEqual([original]);
    });

    it('accepts output that preserves placeholders with no HTML entities', async () => {
      const translated = JSON.stringify({
        message: 'शाबाश, <user_name>!',
      });
      const createMock = jest.fn().mockResolvedValue(translated);
      completionMock = createMock;
      const service = createService({});
      const original = JSON.stringify({ message: 'Great job, <user_name>!' });
      const result = await (service as any).fetchTranslations(
        [original],
        'hi',
        'sys',
        'usr',
      );
      expect(result).toEqual([translated]);
    });
  });

  describe('translateScenarioData', () => {
    it('returns empty object for empty languages', async () => {
      const service = createService({});
      const result = await service.translateScenarioData(
        sourceObject,
        [],
        null,
      );
      expect(result).toEqual({});
    });
    it('prefetches templates once; translates per language', async () => {
      const getPromptByCode = jest
        .fn()
        .mockResolvedValueOnce('SYS {{languageName}}')
        .mockResolvedValueOnce('USR {{languageName}} {{inputJson}}');
      const service = createService({ getPromptByCode });
      const spy = jest
        .spyOn(service as any, 'fetchTranslations')
        .mockResolvedValue([JSON.stringify({ title: 'ok' })]);
      const result = await service.translateScenarioData(
        sourceObject,
        ['hi', 'pa'],
        scenarioContext,
      );
      expect(getPromptByCode).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(result.hi.title).toBeDefined();
      expect(result.pa.title).toBeDefined();
    });
    it('falls back to original object on error', async () => {
      const service = createService({
        getPromptByCode: jest.fn().mockResolvedValue(null),
      });
      jest
        .spyOn(service as any, 'fetchTranslations')
        .mockResolvedValue(['not-json']);
      const result = await service.translateScenarioData(
        sourceObject,
        ['hi'],
        scenarioContext,
      );
      expect(result.hi.title).toBe('Hello');
    });
  });

  describe('translateObjectToLanguages', () => {
    it('returns empty object for empty languages', async () => {
      const service = createService({});
      const result = await service.translateObjectToLanguages(
        sourceObject,
        [],
        'sys',
      );
      expect(result).toEqual({});
    });

    it('translates object to multiple languages', async () => {
      const createMock = jest
        .fn()
        .mockResolvedValue(JSON.stringify({ title: 'नमस्ते' }));
      completionMock = createMock;
      // Mock prompt retrieval to return a template
      const getPromptByCode = jest
        .fn()
        .mockResolvedValue('SYS {{languageName}} {{inputJson}}');
      const service = createService({ getPromptByCode });

      const result = await service.translateObjectToLanguages(
        sourceObject,
        ['hi', 'pa'],
        'sys',
      );
      expect(result.hi.title).toBe('नमस्ते');
      expect(result.pa.title).toBe('नमस्ते');
    });

    it('falls back to original object on parse error', async () => {
      const createMock = jest.fn().mockResolvedValue('not-json');
      completionMock = createMock;
      // Mock prompt retrieval
      const getPromptByCode = jest
        .fn()
        .mockResolvedValue('SYS {{languageName}} {{inputJson}}');
      const service = createService({ getPromptByCode });

      const result = await service.translateObjectToLanguages(
        sourceObject,
        ['hi'],
        'sys',
      );
      expect(result.hi.title).toBe('Hello');
    });

    it('returns original object when API fails', async () => {
      const createMock = jest.fn().mockRejectedValue(new Error('API error'));
      completionMock = createMock;
      // Mock prompt retrieval
      const getPromptByCode = jest
        .fn()
        .mockResolvedValue('SYS {{languageName}} {{inputJson}}');
      const service = createService({ getPromptByCode });

      const result = await service.translateObjectToLanguages(
        sourceObject,
        ['hi'],
        'sys',
      );
      expect(result.hi.title).toBe('Hello');
    });

    it('returns original object when API returns empty content', async () => {
      const createMock = jest.fn().mockResolvedValue('');
      completionMock = createMock;
      // Mock prompt retrieval
      const getPromptByCode = jest
        .fn()
        .mockResolvedValue('SYS {{languageName}} {{inputJson}}');
      const service = createService({ getPromptByCode });

      const result = await service.translateObjectToLanguages(
        sourceObject,
        ['hi'],
        'sys',
      );
      expect(result.hi.title).toBe('Hello');
    });
  });

  describe('prompt builders and template rendering', () => {
    const scenario = { title: 'Hero', tone: 'Warm' } as any;

    it('renderTemplate substitutes variables and omits missing', () => {
      const service = createService({});
      const fn = (service as any).renderTemplate.bind(service);
      const tpl = 'Hello {{name}} {{missing}} in {{languageName}}';
      const out = fn(tpl, { name: 'World', languageName: 'Hindi' });
      expect(out).toBe('Hello World  in Hindi');
    });

    it('renderTemplate handles whitespace inside placeholders', () => {
      const service = createService({});
      const fn = (service as any).renderTemplate.bind(service);
      const tpl = 'Start {{ languageName }} End';
      const out = fn(tpl, { languageName: 'Hindi' });
      expect(out).toBe('Start Hindi End');
    });

    it('renderTemplate replaces multiple occurrences', () => {
      const service = createService({});
      const fn = (service as any).renderTemplate.bind(service);
      const tpl = 'Hi {{name}}! Bye {{name}}.';
      const out = fn(tpl, { name: 'Sam' });
      expect(out).toBe('Hi Sam! Bye Sam.');
    });

    it('renderTemplate leaves text unchanged when no placeholders', () => {
      const service = createService({});
      const fn = (service as any).renderTemplate.bind(service);
      const tpl = 'No placeholders here.';
      const out = fn(tpl, {});
      expect(out).toBe('No placeholders here.');
    });

    it('buildUserPrompt uses override and includes inputJson', async () => {
      const service = createService({});
      const tpl = 'USR {{languageName}} {{inputJson}}';
      const out = await (service as any).buildUserPrompt(
        { title: 'Hello' },
        'hi-IN',
        tpl,
      );
      expect(out).toContain('USR');
      expect(out).toContain('Hindi');
      expect(out).toContain('"title": "Hello"');
    });

    it('buildUserPrompt uses DB template when available', async () => {
      const getPromptByCode = jest
        .fn()
        .mockResolvedValueOnce('USR {{languageName}} {{inputJson}}');
      const service = createService({ getPromptByCode });
      const out = await (service as any).buildUserPrompt(
        { title: 'Hello' },
        'hi-IN',
      );
      expect(getPromptByCode).toHaveBeenCalledTimes(1);
      expect(out).toContain('Hindi');
      expect(out).toContain('"title": "Hello"');
    });

    it('buildUserPrompt falls back to default when DB returns null', async () => {
      const getPromptByCode = jest.fn().mockResolvedValueOnce(null);
      const service = createService({ getPromptByCode });
      const out = await (service as any).buildUserPrompt(
        { title: 'Hello' },
        'hi-IN',
      );
      expect(getPromptByCode).toHaveBeenCalledTimes(1);
      expect(out).toContain('Hindi');
      expect(out).toContain('"title": "Hello"');
    });

    it('buildSystemPrompt uses override and substitutes variables', async () => {
      const service = createService({});
      const tpl = 'SYS {{languageName}} {{toneGuidance}} {{preserveWords}}';
      const out = await (service as any).buildSystemPrompt(
        'hi-IN',
        scenario,
        tpl,
      );
      expect(out).toContain('SYS');
      expect(out).toContain('Hindi');
    });

    it('buildSystemPrompt uses DB template when available', async () => {
      const getPromptByCode = jest
        .fn()
        .mockResolvedValueOnce(
          'SYS {{languageName}} {{toneGuidance}} {{preserveWords}}',
        );
      const service = createService({ getPromptByCode });
      const out = await (service as any).buildSystemPrompt('hi-IN', scenario);
      expect(getPromptByCode).toHaveBeenCalledTimes(1);
      expect(out).toContain('Hindi');
    });

    it('buildSystemPrompt falls back to default when DB returns null', async () => {
      const getPromptByCode = jest.fn().mockResolvedValueOnce(null);
      const service = createService({ getPromptByCode });
      const out = await (service as any).buildSystemPrompt('hi-IN', scenario);
      expect(getPromptByCode).toHaveBeenCalledTimes(1);
      expect(out).toContain('Hindi');
    });
  });

  describe('getFallbackPromptTemplate', () => {
    it('returns fallback prompt template', () => {
      const service = createService({});
      const out = (service as any).getFallbackPromptTemplate(
        toPromptCode('openai_translation', 'session_event'),
      );
      expect(out).toContain('{{languageName}}');
    });
  });
});
