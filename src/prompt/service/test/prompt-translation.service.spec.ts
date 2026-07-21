import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PromptsRepository } from '../../repository/prompt.repository';
import { PromptVersionRepository } from '../../repository/prompt-version.repository';
import { PromptTranslationRepository } from '../../repository/prompt-translation.repository';
import { PromptSharedService } from '../prompt-shared.service';
import { PromptTranslationProviderService } from '../prompt-translation-provider.service';
import { PromptTranslationTargetsService } from '../prompt-translation-targets.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { PromptTranslationService } from '../prompt-translation.service';
import { PromptTranslationStatus } from '../../entity/prompt-translation.entity';

describe('PromptTranslationService.translateOne', () => {
  let service: PromptTranslationService;

  const promptId = 'p-1';
  const languageId = 2; // Hindi
  const englishBody = 'You are {name}, a nurse. [laughs]';

  let getPromptByCode: jest.Mock;
  let getPromptsByOptions: jest.Mock;
  let getLatestPromptVersion: jest.Mock;
  let getLanguagesByIds: jest.Mock;
  let translate: jest.Mock;
  let upsertTranslation: jest.Mock;
  let update: jest.Mock;
  let markStatus: jest.Mock;
  let promptFindOne: jest.Mock;
  let findTranslationSources: jest.Mock;
  let findByPromptAndLanguage: jest.Mock;
  let getEligibleTargetLanguages: jest.Mock;
  let getRuntimeRows: jest.Mock;

  const engine = {
    provider: 'gemini',
    model: 'gemini-2.5-pro',
    temperature: 0.2,
    maxTokens: 8192,
  };

  beforeEach(async () => {
    promptFindOne = jest.fn().mockResolvedValue({
      id: promptId,
      promptCode: 'main_agent_x',
      promptType: 'main_agent',
      translationEnabled: true,
    });
    findTranslationSources = jest.fn().mockResolvedValue([]);
    findByPromptAndLanguage = jest.fn().mockResolvedValue(null);
    getEligibleTargetLanguages = jest.fn().mockResolvedValue([]);
    getRuntimeRows = jest.fn().mockResolvedValue([]);
    getPromptByCode = jest.fn().mockResolvedValue(englishBody);
    getPromptsByOptions = jest
      .fn()
      .mockResolvedValue([
        { prompt: 'Translate to {{languageName}}.', currentVersion: 1 },
      ]);
    getLatestPromptVersion = jest.fn().mockResolvedValue({ id: 'v-1' });
    getLanguagesByIds = jest
      .fn()
      .mockResolvedValue([
        { id: languageId, translationCode: 'hi', label: 'Hindi (India)' },
      ]);
    translate = jest.fn();
    upsertTranslation = jest.fn().mockResolvedValue(undefined);
    update = jest.fn().mockResolvedValue(undefined);
    markStatus = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptTranslationService,
        {
          provide: PromptsRepository,
          useValue: { findOne: promptFindOne, findTranslationSources },
        },
        {
          provide: PromptVersionRepository,
          useValue: { getLatestPromptVersion },
        },
        {
          provide: PromptTranslationRepository,
          useValue: {
            upsertTranslation,
            update,
            markStatus,
            findByPromptAndLanguage,
            getRuntimeRows,
          },
        },
        {
          provide: PromptSharedService,
          useValue: { getPromptByCode, getPromptsByOptions },
        },
        {
          provide: PromptTranslationProviderService,
          useValue: { resolveEngine: () => engine, translate },
        },
        {
          provide: PromptTranslationTargetsService,
          useValue: {
            hashBody: (b: string) => `hash:${b.length}`,
            getEligibleTargetLanguages,
          },
        },
        { provide: SharedLanguageService, useValue: { getLanguagesByIds } },
      ],
    }).compile();

    service = module.get(PromptTranslationService);
  });

  afterEach(() => jest.clearAllMocks());

  it('translates and marks READY when the token guard passes', async () => {
    translate.mockResolvedValue('आप {name} हैं, एक नर्स। [laughs]');

    const result = await service.translateOne(promptId, languageId);

    expect(result.status).toBe(PromptTranslationStatus.READY);
    expect(result.attempts).toBe(1);
    // in-progress row first, then finalized to ready
    expect(upsertTranslation).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId,
        languageId,
        status: PromptTranslationStatus.TRANSLATING,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
      }),
    );
    expect(update).toHaveBeenCalledWith(
      { promptId, languageId },
      expect.objectContaining({
        status: PromptTranslationStatus.READY,
        translatedPrompt: 'आप {name} हैं, एक नर्स। [laughs]',
        error: undefined,
      }),
    );
  });

  it('fills {{languageName}} with the target language label', async () => {
    translate.mockResolvedValue('आप {name} हैं [laughs]');

    await service.translateOne(promptId, languageId);

    const [systemPrompt] = translate.mock.calls[0];
    expect(systemPrompt).toBe('Translate to Hindi (India).');
  });

  it('retries then succeeds — dropped placeholder on attempt 1, valid on attempt 2', async () => {
    translate
      .mockResolvedValueOnce('आप हैं, एक नर्स। [laughs]') // {name} dropped
      .mockResolvedValueOnce('आप {name} हैं, एक नर्स। [laughs]');

    const result = await service.translateOne(promptId, languageId);

    expect(result.status).toBe(PromptTranslationStatus.READY);
    expect(result.attempts).toBe(2);
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('marks FAILED after exhausting attempts when tokens never preserved', async () => {
    translate.mockResolvedValue('आप हैं, एक नर्स।'); // always drops {name} and [laughs]

    const result = await service.translateOne(promptId, languageId);

    expect(result.status).toBe(PromptTranslationStatus.FAILED);
    expect(translate).toHaveBeenCalledTimes(3);
    expect(markStatus).toHaveBeenCalledWith(
      promptId,
      languageId,
      PromptTranslationStatus.FAILED,
      expect.stringContaining('{name}'),
    );
  });

  it('refuses to translate into the source (English) language', async () => {
    getLanguagesByIds.mockResolvedValue([
      { id: 1, translationCode: 'en', label: 'English (India)' },
    ]);

    await expect(service.translateOne(promptId, 1)).rejects.toThrow(
      BadRequestException,
    );
    expect(translate).not.toHaveBeenCalled();
  });

  it('throws NotFound when the source prompt is missing', async () => {
    promptFindOne.mockResolvedValue(null);

    await expect(service.translateOne('missing', languageId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects when the prompt has no resolvable English body', async () => {
    getPromptByCode.mockResolvedValue('   ');

    await expect(service.translateOne(promptId, languageId)).rejects.toThrow(
      BadRequestException,
    );
  });

  describe('translatePrompt', () => {
    const langs = [
      { id: 2, translationCode: 'hi', label: 'Hindi (India)' },
      { id: 6, translationCode: 'ta', label: 'Tamil (India)' },
    ];

    it('is a no-op when translation is not enabled', async () => {
      promptFindOne.mockResolvedValue({
        id: promptId,
        promptCode: 'main_agent_x',
        promptType: 'main_agent',
        translationEnabled: false,
      });
      const spy = jest.spyOn(service, 'translateOne');

      const result = await service.translatePrompt(promptId);

      expect(result.eligible).toBe(false);
      expect(result.reason).toMatch(/not enabled/);
      expect(spy).not.toHaveBeenCalled();
    });

    it('is a no-op for a non-translatable promptType', async () => {
      promptFindOne.mockResolvedValue({
        id: promptId,
        promptCode: 'x',
        promptType: 'multilingual',
        translationEnabled: true,
      });
      const spy = jest.spyOn(service, 'translateOne');

      const result = await service.translatePrompt(promptId);

      expect(result.eligible).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it('translates every eligible language when none are fresh', async () => {
      getEligibleTargetLanguages.mockResolvedValue(langs);
      findByPromptAndLanguage.mockResolvedValue(null);
      const spy = jest.spyOn(service, 'translateOne').mockResolvedValue({
        status: PromptTranslationStatus.READY,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        attempts: 1,
      });

      const result = await service.translatePrompt(promptId);

      expect(result.translated).toBe(2);
      expect(result.skipped).toBe(0);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith(promptId, 2);
      expect(spy).toHaveBeenCalledWith(promptId, 6);
    });

    it('skips a language already fresh by sourceHash and translates the stale one', async () => {
      getEligibleTargetLanguages.mockResolvedValue(langs);
      getPromptByCode.mockResolvedValue('BODY'); // hashBody -> 'hash:4'
      findByPromptAndLanguage.mockImplementation((_p: string, lid: number) =>
        lid === 2
          ? { status: PromptTranslationStatus.READY, sourceHash: 'hash:4' }
          : { status: PromptTranslationStatus.READY, sourceHash: 'stale' },
      );
      const spy = jest.spyOn(service, 'translateOne').mockResolvedValue({
        status: PromptTranslationStatus.READY,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        attempts: 1,
      });

      const result = await service.translatePrompt(promptId);

      expect(result.skipped).toBe(1); // hi fresh
      expect(result.translated).toBe(1); // ta stale
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(promptId, 6);
    });

    it('counts a language as failed when translateOne returns FAILED', async () => {
      getEligibleTargetLanguages.mockResolvedValue([langs[0]]);
      findByPromptAndLanguage.mockResolvedValue(null);
      jest.spyOn(service, 'translateOne').mockResolvedValue({
        status: PromptTranslationStatus.FAILED,
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        attempts: 3,
        error: 'token mismatch',
      });

      const result = await service.translatePrompt(promptId);

      expect(result.failed).toBe(1);
      expect(result.translated).toBe(0);
    });
  });

  describe('overlayTranslations', () => {
    const englishByCode = { code1: 'AAAA' }; // hashBody -> 'hash:4'

    const row = (over: Partial<Record<string, unknown>> = {}) => ({
      promptCode: 'code1',
      promptId: 'p1',
      translationEnabled: true,
      promptType: 'main_agent',
      translatedPrompt: 'अनुवाद',
      sourceHash: 'hash:4',
      status: PromptTranslationStatus.READY,
      ...over,
    });

    it('skips entirely for the source (English) language', async () => {
      getLanguagesByIds.mockResolvedValue([
        { id: 1, translationCode: 'en', label: 'English (India)' },
      ]);

      const out = await service.overlayTranslations(englishByCode, 1);

      expect(out).toEqual(englishByCode);
      expect(getRuntimeRows).not.toHaveBeenCalled();
    });

    it('serves the translated body when ready and sourceHash matches', async () => {
      getRuntimeRows.mockResolvedValue([row()]);
      const heal = jest.spyOn(service, 'translateOne');

      const out = await service.overlayTranslations(englishByCode, 2);

      expect(out.code1).toBe('अनुवाद');
      expect(heal).not.toHaveBeenCalled();
    });

    it('falls back to English and self-heals the stale language only', async () => {
      getRuntimeRows.mockResolvedValue([row({ sourceHash: 'hash:STALE' })]);
      const heal = jest
        .spyOn(service, 'translateOne')
        .mockResolvedValue({} as never);

      const out = await service.overlayTranslations(englishByCode, 2);

      expect(out.code1).toBe('AAAA');
      // targets the specific (promptId, languageId), not all languages
      expect(heal).toHaveBeenCalledWith('p1', 2);
    });

    it('falls back and self-heals when no translation exists yet (missing)', async () => {
      getRuntimeRows.mockResolvedValue([
        row({ translatedPrompt: null, sourceHash: null, status: null }),
      ]);
      const heal = jest
        .spyOn(service, 'translateOne')
        .mockResolvedValue({} as never);

      const out = await service.overlayTranslations(englishByCode, 2);

      expect(out.code1).toBe('AAAA');
      expect(heal).toHaveBeenCalledWith('p1', 2);
    });

    it('does NOT self-heal a FAILED translation (no per-session retry storm)', async () => {
      getRuntimeRows.mockResolvedValue([
        row({ status: PromptTranslationStatus.FAILED, translatedPrompt: null }),
      ]);
      const heal = jest.spyOn(service, 'translateOne');

      const out = await service.overlayTranslations(englishByCode, 2);

      expect(out.code1).toBe('AAAA'); // English fallback
      expect(heal).not.toHaveBeenCalled();
    });

    it('ignores disabled / non-translatable rows (no overlay, no self-heal)', async () => {
      getRuntimeRows.mockResolvedValue([
        row({ translationEnabled: false }),
        {
          ...row(),
          promptCode: 'code2',
          promptId: 'p2',
          promptType: 'multilingual',
        },
      ]);
      const heal = jest.spyOn(service, 'translateOne');

      const out = await service.overlayTranslations(
        { code1: 'AAAA', code2: 'BBBB' },
        2,
      );

      expect(out.code1).toBe('AAAA');
      expect(out.code2).toBe('BBBB');
      expect(heal).not.toHaveBeenCalled();
    });

    it('returns input unchanged when languageId is falsy', async () => {
      const out = await service.overlayTranslations(englishByCode, 0);
      expect(out).toEqual(englishByCode);
      expect(getLanguagesByIds).not.toHaveBeenCalled();
    });
  });

  describe('backfillEnabledPrompts', () => {
    it('translates every enabled source and aggregates the totals', async () => {
      findTranslationSources.mockResolvedValue([
        { id: 'a', promptCode: 'x', promptType: 'main_agent' },
        { id: 'b', promptCode: 'y', promptType: 'branching' },
      ]);
      const spy = jest
        .spyOn(service, 'translatePrompt')
        .mockResolvedValueOnce({
          promptId: 'a',
          eligible: true,
          translated: 4,
          skipped: 0,
          failed: 0,
        })
        .mockResolvedValueOnce({
          promptId: 'b',
          eligible: true,
          translated: 3,
          skipped: 1,
          failed: 0,
        });

      const result = await service.backfillEnabledPrompts();

      expect(spy).toHaveBeenCalledTimes(2);
      expect(result.sources).toBe(2);
      expect(result.translated).toBe(7);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('is a no-op when there are no enabled sources', async () => {
      findTranslationSources.mockResolvedValue([]);
      const spy = jest.spyOn(service, 'translatePrompt');

      const result = await service.backfillEnabledPrompts();

      expect(result.sources).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
