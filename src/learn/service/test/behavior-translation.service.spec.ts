import { Test, TestingModule } from '@nestjs/testing';
import { BehaviorTranslationService } from '../behavior-translation.service';
import { BehaviorInstructionTranslationService } from '../behavior-instruction-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from '../scenario-shared.service';
import { BehaviorTranslationRepository } from '../../repository/behavior-translation.repository';
import { Behavior } from '../../entity/behavior.entity';

describe('BehaviorTranslationService', () => {
  let service: BehaviorTranslationService;
  let behaviorInstructionTranslationService: jest.Mocked<BehaviorInstructionTranslationService>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let behaviorTranslationRepository: jest.Mocked<BehaviorTranslationRepository>;

  const mockBehavior = {
    id: 'behavior-uuid-1',
    name: 'Active Listening',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as Behavior;

  const mockLanguages = [
    { id: 2, translationCode: 'es', value: 'Spanish', label: 'Spanish' },
    { id: 3, translationCode: 'fr', value: 'Français', label: 'French' },
  ];

  beforeEach(async () => {
    const mockBehaviorInstructionTranslationService = {
      buildTranslatedMetadataForLanguageCodes: jest.fn(),
    };

    const mockSharedLanguageService = {
      getValidLanguages: jest.fn(),
    };

    const mockScenarioSharedService = {
      getUniqueLanguagesFromScenarioTranslations: jest.fn(),
    };

    const mockBehaviorTranslationRepository = {
      save: jest.fn(),
      getTranslationsByBehaviorId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BehaviorTranslationService,
        {
          provide: BehaviorInstructionTranslationService,
          useValue: mockBehaviorInstructionTranslationService,
        },
        {
          provide: SharedLanguageService,
          useValue: mockSharedLanguageService,
        },
        {
          provide: ScenarioSharedService,
          useValue: mockScenarioSharedService,
        },
        {
          provide: BehaviorTranslationRepository,
          useValue: mockBehaviorTranslationRepository,
        },
      ],
    }).compile();

    service = module.get<BehaviorTranslationService>(
      BehaviorTranslationService,
    );
    behaviorInstructionTranslationService = module.get(
      BehaviorInstructionTranslationService,
    );
    sharedLanguageService = module.get(SharedLanguageService);
    scenarioSharedService = module.get(ScenarioSharedService);
    behaviorTranslationRepository = module.get(BehaviorTranslationRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createBehaviorTranslations', () => {
    it('should skip when no valid language codes exist', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [],
      );

      await service.createBehaviorTranslations([mockBehavior]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).not.toHaveBeenCalled();
      expect(behaviorTranslationRepository.save).not.toHaveBeenCalled();
    });

    it('should skip when getUniqueLanguagesFromScenarioTranslations returns null', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        null as any,
      );

      await service.createBehaviorTranslations([mockBehavior]);

      expect(sharedLanguageService.getValidLanguages).not.toHaveBeenCalled();
    });

    it('should skip when no valid languages returned', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2, 3],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [],
        languagesMap: {} as any,
      });

      await service.createBehaviorTranslations([mockBehavior]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).not.toHaveBeenCalled();
    });

    it('should translate and save behavior translations', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2, 3],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: mockLanguages as any,
        languagesMap: {} as any,
      });
      behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes.mockResolvedValue(
        {
          es: { name: 'Escucha Activa' },
          fr: { name: 'Écoute Active' },
        },
      );
      behaviorTranslationRepository.save.mockResolvedValue([] as any);

      await service.createBehaviorTranslations([mockBehavior]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).toHaveBeenCalledWith({ name: 'Active Listening' }, ['es', 'fr']);
      expect(behaviorTranslationRepository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            behaviorId: 'behavior-uuid-1',
            languageId: 2,
            name: 'Escucha Activa',
          }),
          expect.objectContaining({
            behaviorId: 'behavior-uuid-1',
            languageId: 3,
            name: 'Écoute Active',
          }),
        ]),
      );
    });

    it('should skip behaviors with empty name', async () => {
      const emptyBehavior = { ...mockBehavior, name: '  ' } as Behavior;

      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: mockLanguages as any,
        languagesMap: {} as any,
      });

      await service.createBehaviorTranslations([emptyBehavior]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).not.toHaveBeenCalled();
    });

    it('should skip English languages', async () => {
      const englishLanguages = [
        { id: 1, translationCode: 'en', value: 'en-IN', label: 'English' },
      ];

      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [1],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: englishLanguages as any,
        languagesMap: {} as any,
      });

      await service.createBehaviorTranslations([mockBehavior]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).not.toHaveBeenCalled();
    });

    it('should handle translation errors gracefully', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });
      behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes.mockRejectedValue(
        new Error('Translation failed'),
      );

      await expect(
        service.createBehaviorTranslations([mockBehavior]),
      ).resolves.not.toThrow();

      expect(behaviorTranslationRepository.save).not.toHaveBeenCalled();
    });

    it('should skip when translation returns empty result for language', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });
      behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes.mockResolvedValue(
        { es: {} },
      );

      await service.createBehaviorTranslations([mockBehavior]);

      expect(behaviorTranslationRepository.save).not.toHaveBeenCalled();
    });
  });
});
