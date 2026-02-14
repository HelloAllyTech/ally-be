import { Test, TestingModule } from '@nestjs/testing';
import { ConversationalGuardrailsTranslationService } from '../conversational-guardrails-translation.service';
import { ConversationalGuardrailsTranslationsRepository } from '../../repository/conversational-guardrails-translations.repository';
import { GoogleTranslationsService } from 'src/common/service/google-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ConversationalGuardrails } from '../../entity/conversational-guardrails.entity';
import { ConversationalGuardrailsTranslations } from '../../entity/conversational-guardrails-translations.entity';

describe('ConversationalGuardrailsTranslationService', () => {
  let service: ConversationalGuardrailsTranslationService;
  let translationsRepository: jest.Mocked<ConversationalGuardrailsTranslationsRepository>;
  let googleTranslationService: jest.Mocked<GoogleTranslationsService>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;

  const mockGuardrail: ConversationalGuardrails = {
    id: 'guardrail-uuid-1',
    name: 'Guardrail 1',
    helperDialogue: 'rude behavior',
    actorDialogue: 'Please be respectful',
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as ConversationalGuardrails;

  const mockLanguages = [
    { id: 2, translationCode: 'es', value: 'Spanish', label: 'Spanish' },
    { id: 3, translationCode: 'fr', value: 'French', label: 'French' },
  ];

  const mockTranslation: ConversationalGuardrailsTranslations = {
    id: 'translation-uuid-1',
    guardrailId: 'guardrail-uuid-1',
    languageId: 2,
    helperDialogue: 'comportamiento grosero',
    actorDialogue: 'Por favor sea respetuoso',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as ConversationalGuardrailsTranslations;

  beforeEach(async () => {
    const mockTranslationsRepository = {
      getTranslationsByGuardrailId: jest.fn(),
      getTranslationsForGuardrails: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    const mockGoogleTranslationService = {
      translateObjectToLanguages: jest.fn(),
    };

    const mockSharedLanguageService = {
      getValidLanguages: jest.fn(),
    };

    const mockScenarioSharedService = {
      getUniqueLanguagesFromScenarioTranslations: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationalGuardrailsTranslationService,
        {
          provide: ConversationalGuardrailsTranslationsRepository,
          useValue: mockTranslationsRepository,
        },
        {
          provide: GoogleTranslationsService,
          useValue: mockGoogleTranslationService,
        },
        {
          provide: SharedLanguageService,
          useValue: mockSharedLanguageService,
        },
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioSharedService,
        },
      ],
    }).compile();

    service = module.get<ConversationalGuardrailsTranslationService>(
      ConversationalGuardrailsTranslationService,
    );
    translationsRepository = module.get(
      ConversationalGuardrailsTranslationsRepository,
    );
    googleTranslationService = module.get(GoogleTranslationsService);
    sharedLanguageService = module.get(SharedLanguageService);
    scenarioSharedService = module.get(ScenarioSharedService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have all dependencies injected', () => {
      expect(translationsRepository).toBeDefined();
      expect(googleTranslationService).toBeDefined();
      expect(sharedLanguageService).toBeDefined();
      expect(scenarioSharedService).toBeDefined();
    });
  });

  describe('createUpdateGuardrailTranslations', () => {
    it('should skip when no valid language codes exist', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [],
      );

      await service.createUpdateGuardrailTranslations([mockGuardrail]);

      expect(
        googleTranslationService.translateObjectToLanguages,
      ).not.toHaveBeenCalled();
      expect(translationsRepository.save).not.toHaveBeenCalled();
    });

    it('should translate and persist guardrail translations for valid languages', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2, 3],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: mockLanguages as any,
        languagesMap: {} as any,
      });
      googleTranslationService.translateObjectToLanguages.mockResolvedValue({
        es: {
          helperDialogue: 'comportamiento grosero',
          actorDialogue: 'Por favor sea respetuoso',
        },
        fr: {
          helperDialogue: 'comportement grossier',
          actorDialogue: 'Veuillez être respectueux',
        },
      });
      translationsRepository.getTranslationsByGuardrailId.mockResolvedValue([]);
      translationsRepository.save.mockResolvedValue([mockTranslation] as any);

      await service.createUpdateGuardrailTranslations([mockGuardrail]);

      expect(
        scenarioSharedService.getUniqueLanguagesFromScenarioTranslations,
      ).toHaveBeenCalled();
      expect(sharedLanguageService.getValidLanguages).toHaveBeenCalledWith([
        2, 3,
      ]);
      expect(
        googleTranslationService.translateObjectToLanguages,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          helperDialogue: 'rude behavior',
          actorDialogue: 'Please be respectful',
        }),
        ['es', 'fr'],
      );
      expect(translationsRepository.save).toHaveBeenCalled();
    });

    it('should update existing translations instead of creating new ones', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });
      googleTranslationService.translateObjectToLanguages.mockResolvedValue({
        es: {
          helperDialogue: 'comportamiento grosero actualizado',
          actorDialogue: 'Por favor sea respetuoso actualizado',
        },
      });
      translationsRepository.getTranslationsByGuardrailId.mockResolvedValue([
        mockTranslation,
      ]);

      await service.createUpdateGuardrailTranslations([mockGuardrail]);

      expect(translationsRepository.update).toHaveBeenCalledWith(
        { guardrailId: 'guardrail-uuid-1', languageId: 2 },
        expect.objectContaining({
          helperDialogue: 'comportamiento grosero actualizado',
          actorDialogue: 'Por favor sea respetuoso actualizado',
        }),
      );
    });

    it('should skip guardrails with empty metadata', async () => {
      const emptyGuardrail = {
        ...mockGuardrail,
        helperDialogue: '',
        actorDialogue: '',
      };
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });

      await service.createUpdateGuardrailTranslations([emptyGuardrail]);

      expect(
        googleTranslationService.translateObjectToLanguages,
      ).not.toHaveBeenCalled();
    });

    it('should handle translation API errors gracefully', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });
      googleTranslationService.translateObjectToLanguages.mockRejectedValue(
        new Error('Translation API failed'),
      );

      await expect(
        service.createUpdateGuardrailTranslations([mockGuardrail]),
      ).resolves.not.toThrow();

      expect(translationsRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getGuardrailsWithTranslations', () => {
    it('should return guardrails without translations when languageId is not provided', async () => {
      const result = await service.getGuardrailsWithTranslations(
        [mockGuardrail],
        0,
      );

      expect(result).toEqual([mockGuardrail]);
      expect(
        translationsRepository.getTranslationsForGuardrails,
      ).not.toHaveBeenCalled();
    });

    it('should return guardrails with translated content when languageId is provided', async () => {
      translationsRepository.getTranslationsForGuardrails.mockResolvedValue([
        mockTranslation,
      ]);

      const result = await service.getGuardrailsWithTranslations(
        [mockGuardrail],
        2,
      );

      expect(result[0].helperDialogue).toBe('comportamiento grosero');
      expect(result[0].actorDialogue).toBe('Por favor sea respetuoso');
      expect(
        translationsRepository.getTranslationsForGuardrails,
      ).toHaveBeenCalledWith(['guardrail-uuid-1'], 2);
    });

    it('should return original guardrail when no translation exists for the language', async () => {
      translationsRepository.getTranslationsForGuardrails.mockResolvedValue([]);

      const result = await service.getGuardrailsWithTranslations(
        [mockGuardrail],
        99,
      );

      expect(result[0].helperDialogue).toBe('rude behavior');
      expect(result[0].actorDialogue).toBe('Please be respectful');
    });

    it('should return empty array when guardrails array is empty', async () => {
      const result = await service.getGuardrailsWithTranslations([], 2);

      expect(result).toEqual([]);
      expect(
        translationsRepository.getTranslationsForGuardrails,
      ).not.toHaveBeenCalled();
    });
  });

  describe('persistGuardrailTranslations', () => {
    it('should create new translations for new guardrails', async () => {
      const metadataExtractor = (g: ConversationalGuardrails) => ({
        helperDialogue: g.helperDialogue,
        actorDialogue: g.actorDialogue,
      });

      googleTranslationService.translateObjectToLanguages.mockResolvedValue({
        es: {
          helperDialogue: 'comportamiento grosero',
          actorDialogue: 'Por favor sea respetuoso',
        },
      });
      translationsRepository.getTranslationsByGuardrailId.mockResolvedValue([]);
      translationsRepository.save.mockResolvedValue([mockTranslation] as any);

      await service.persistGuardrailTranslations(
        [mockGuardrail],
        metadataExtractor,
        mockLanguages.slice(0, 1) as any,
      );

      expect(translationsRepository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            guardrailId: 'guardrail-uuid-1',
            languageId: 2,
            helperDialogue: 'comportamiento grosero',
            actorDialogue: 'Por favor sea respetuoso',
          }),
        ]),
      );
    });

    it('should handle multiple guardrails in batch', async () => {
      const guardrails = [
        mockGuardrail,
        {
          ...mockGuardrail,
          id: 'guardrail-uuid-2',
          helperDialogue: 'interrupting',
          actorDialogue: 'Let me finish',
        },
      ];

      const metadataExtractor = (g: ConversationalGuardrails) => ({
        helperDialogue: g.helperDialogue,
        actorDialogue: g.actorDialogue,
      });

      googleTranslationService.translateObjectToLanguages.mockResolvedValue({
        es: {
          helperDialogue: 'translated helper',
          actorDialogue: 'translated actor',
        },
      });
      translationsRepository.getTranslationsByGuardrailId.mockResolvedValue([]);
      translationsRepository.save.mockResolvedValue([] as any);

      await service.persistGuardrailTranslations(
        guardrails,
        metadataExtractor,
        mockLanguages.slice(0, 1) as any,
      );

      expect(translationsRepository.save).toHaveBeenCalledTimes(2);
    });
  });
});
