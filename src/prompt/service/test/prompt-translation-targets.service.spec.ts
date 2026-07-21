import { Test, TestingModule } from '@nestjs/testing';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { Languages } from 'src/language/entity/languages.entity';
import { PromptSharedService } from '../prompt-shared.service';
import { PromptTranslationTargetsService } from '../prompt-translation-targets.service';

describe('PromptTranslationTargetsService', () => {
  let service: PromptTranslationTargetsService;
  let getPromptByCode: jest.Mock;
  let getEligibleAppLanguages: jest.Mock;

  beforeEach(async () => {
    getPromptByCode = jest.fn();
    getEligibleAppLanguages = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptTranslationTargetsService,
        { provide: PromptSharedService, useValue: { getPromptByCode } },
        {
          provide: SharedLanguageService,
          useValue: { getEligibleAppLanguages },
        },
      ],
    }).compile();

    service = module.get(PromptTranslationTargetsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('hashBody', () => {
    it('is deterministic and 64 hex chars (sha256)', () => {
      const h = service.hashBody('You are {name}.');
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(service.hashBody('You are {name}.')).toBe(h);
    });

    it('changes when the body changes', () => {
      expect(service.hashBody('v1 body')).not.toBe(service.hashBody('v2 body'));
    });

    it('ignores surrounding whitespace so store-time and serve-time hashes agree', () => {
      // store-time body (raw from getPromptByCode, often trailing newline) must
      // hash the same as the trimmed body shipped in room metadata.
      expect(service.hashBody('You are {name}.\n')).toBe(
        service.hashBody('You are {name}.'),
      );
      expect(service.hashBody('  You are {name}.  ')).toBe(
        service.hashBody('You are {name}.'),
      );
    });
  });

  describe('hashEffectiveBody', () => {
    it('hashes the resolved effective body', async () => {
      getPromptByCode.mockResolvedValue('You are {name}.');

      const result = await service.hashEffectiveBody('main_agent_x');

      expect(getPromptByCode).toHaveBeenCalledWith('main_agent_x');
      expect(result).toBe(service.hashBody('You are {name}.'));
    });

    it('returns null when the prompt has no resolvable body', async () => {
      getPromptByCode.mockResolvedValue(null);

      expect(await service.hashEffectiveBody('missing')).toBeNull();
    });
  });

  describe('getEligibleTargetLanguages', () => {
    it('delegates to the language domain', async () => {
      const langs = [
        { id: 2, translationCode: 'hi' },
        { id: 6, translationCode: 'ta' },
      ] as Languages[];
      getEligibleAppLanguages.mockResolvedValue(langs);

      expect(await service.getEligibleTargetLanguages()).toBe(langs);
    });
  });
});
