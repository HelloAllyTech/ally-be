import { Test, TestingModule } from '@nestjs/testing';
import { AppConfigService } from 'src/config/config.service';
import { LlmProviderFactory } from 'src/ai-chat/provider/llm-provider.factory';
import { LlmProvider } from 'src/ai-chat/interface/llm-provider.interface';
import { PromptTranslationProviderService } from '../prompt-translation-provider.service';

describe('PromptTranslationProviderService', () => {
  let service: PromptTranslationProviderService;
  let getProvider: jest.Mock;
  let geminiProvider: { getCompletion: jest.Mock };
  let openaiProvider: { getCompletion: jest.Mock };

  const defaults = {
    defaultProvider: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    maxTokens: 8192,
    temperature: 0.2,
  };

  beforeEach(async () => {
    geminiProvider = { getCompletion: jest.fn().mockResolvedValue('अनुवाद') };
    openaiProvider = {
      getCompletion: jest.fn().mockResolvedValue('translation'),
    };
    getProvider = jest.fn(
      (type: string) =>
        (type === 'openai'
          ? openaiProvider
          : geminiProvider) as unknown as LlmProvider,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptTranslationProviderService,
        {
          provide: AppConfigService,
          useValue: { promptTranslation: defaults },
        },
        { provide: LlmProviderFactory, useValue: { getProvider } },
      ],
    }).compile();

    service = module.get(PromptTranslationProviderService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('resolveEngine', () => {
    it('falls back to config defaults when the row has no provider/model', () => {
      expect(service.resolveEngine()).toEqual({
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        temperature: 0.2,
        maxTokens: 8192,
      });
    });

    it('prefers the prompt row provider/model/temperature over defaults', () => {
      expect(
        service.resolveEngine({
          provider: 'openai',
          model: 'gpt-4o',
          temperature: 0,
        }),
      ).toEqual({
        provider: 'openai',
        model: 'gpt-4o',
        temperature: 0,
        maxTokens: 8192,
      });
    });

    it('treats temperature 0 as an explicit value (not falsy fallback)', () => {
      expect(service.resolveEngine({ temperature: 0 }).temperature).toBe(0);
    });
  });

  describe('translate', () => {
    const system = 'Translate faithfully. Preserve {tokens}.';
    const body = 'You are a nurse named {name}.';

    it('routes to Gemini and passes model/temperature/maxTokens through', async () => {
      const engine = service.resolveEngine();

      const out = await service.translate(system, body, engine);

      expect(out).toBe('अनुवाद');
      expect(getProvider).toHaveBeenCalledWith('gemini');
      expect(geminiProvider.getCompletion).toHaveBeenCalledWith(
        [
          { role: 'system', content: system },
          { role: 'user', content: body },
        ],
        { model: 'gemini-2.5-pro', temperature: 0.2, maxTokens: 8192 },
      );
    });

    it('routes to OpenAI when the engine selects it — same call shape', async () => {
      const engine = service.resolveEngine({
        provider: 'openai',
        model: 'gpt-4o',
      });

      const out = await service.translate(system, body, engine);

      expect(out).toBe('translation');
      expect(getProvider).toHaveBeenCalledWith('openai');
      expect(openaiProvider.getCompletion).toHaveBeenCalledWith(
        [
          { role: 'system', content: system },
          { role: 'user', content: body },
        ],
        { model: 'gpt-4o', temperature: 0.2, maxTokens: 8192 },
      );
      expect(geminiProvider.getCompletion).not.toHaveBeenCalled();
    });
  });
});
