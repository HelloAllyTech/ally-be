import { Test, TestingModule } from '@nestjs/testing';
import { BehaviorInstructionTranslationService } from '../behavior-instruction-translation.service';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { PromptCode } from 'src/prompt/enum/prompt-code.enum';

describe('BehaviorInstructionTranslationService', () => {
  let service: BehaviorInstructionTranslationService;
  let openAITranslationService: jest.Mocked<OpenAITranslationsService>;

  beforeEach(async () => {
    const mockOpenAITranslationService = {
      translateObjectToLanguages: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BehaviorInstructionTranslationService,
        {
          provide: OpenAITranslationsService,
          useValue: mockOpenAITranslationService,
        },
      ],
    }).compile();

    service = module.get<BehaviorInstructionTranslationService>(
      BehaviorInstructionTranslationService,
    );
    openAITranslationService = module.get(OpenAITranslationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildTranslatedMetadataForLanguageCodes', () => {
    it('should return empty object when no language codes provided', async () => {
      const result = await service.buildTranslatedMetadataForLanguageCodes(
        { name: 'test' },
        [],
      );

      expect(result).toEqual({});
      expect(
        openAITranslationService.translateObjectToLanguages,
      ).not.toHaveBeenCalled();
    });

    it('should return empty object when language codes are empty strings', async () => {
      const result = await service.buildTranslatedMetadataForLanguageCodes(
        { name: 'test' },
        ['', '  '],
      );

      expect(result).toEqual({});
      expect(
        openAITranslationService.translateObjectToLanguages,
      ).not.toHaveBeenCalled();
    });

    it('should return empty object when metadata is empty', async () => {
      const result = await service.buildTranslatedMetadataForLanguageCodes({}, [
        'es',
      ]);

      expect(result).toEqual({});
      expect(
        openAITranslationService.translateObjectToLanguages,
      ).not.toHaveBeenCalled();
    });

    it('should return empty object when metadata is null', async () => {
      const result = await service.buildTranslatedMetadataForLanguageCodes(
        null as unknown as Record<string, any>,
        ['es'],
      );

      expect(result).toEqual({});
    });

    it('should call OpenAI translation service with correct parameters', async () => {
      const metadata = { name: 'Active Listening' };
      const languageCodes = ['es', 'fr'];
      const expectedTranslation = {
        es: { name: 'Escucha Activa' },
        fr: { name: 'Écoute Active' },
      };

      openAITranslationService.translateObjectToLanguages.mockResolvedValue(
        expectedTranslation,
      );

      const result = await service.buildTranslatedMetadataForLanguageCodes(
        metadata,
        languageCodes,
      );

      expect(
        openAITranslationService.translateObjectToLanguages,
      ).toHaveBeenCalledWith(
        metadata,
        ['es', 'fr'],
        PromptCode.OPENAI_BEHAVIOR_INSTRUCTION_TRANSLATION_PROMPT_CODE,
      );
      expect(result).toEqual(expectedTranslation);
    });

    it('should trim language codes before passing to translation service', async () => {
      const metadata = { name: 'test' };

      openAITranslationService.translateObjectToLanguages.mockResolvedValue({
        es: { name: 'prueba' },
      });

      await service.buildTranslatedMetadataForLanguageCodes(metadata, [
        '  es  ',
      ]);

      expect(
        openAITranslationService.translateObjectToLanguages,
      ).toHaveBeenCalledWith(
        metadata,
        ['es'],
        PromptCode.OPENAI_BEHAVIOR_INSTRUCTION_TRANSLATION_PROMPT_CODE,
      );
    });

    it('should return empty object when translation service returns null', async () => {
      openAITranslationService.translateObjectToLanguages.mockResolvedValue(
        null as any,
      );

      const result = await service.buildTranslatedMetadataForLanguageCodes(
        { name: 'test' },
        ['es'],
      );

      expect(result).toEqual({});
    });

    it('should return empty object and not throw when translation service throws', async () => {
      openAITranslationService.translateObjectToLanguages.mockRejectedValue(
        new Error('Translation API failed'),
      );

      const result = await service.buildTranslatedMetadataForLanguageCodes(
        { name: 'test' },
        ['es'],
      );

      expect(result).toEqual({});
    });
  });
});
