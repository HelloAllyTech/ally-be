import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioBehaviorInstructionTranslationService } from '../scenario-behavior-instruction-translation.service';
import { BehaviorInstructionTranslationService } from '../behavior-instruction-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from '../scenario-shared.service';
import { ScenarioBehaviorInstructionTranslationRepository } from '../../repository/scenario-behavior-instruction-translation.repository';
import { ScenarioBehaviorInstruction } from '../../entity/scenario-behavior-instruction.entity';
import { INSTRUCTION_SEPARATOR } from '../../constants/scenario-behavior-instuctions.constants';

describe('ScenarioBehaviorInstructionTranslationService', () => {
  let service: ScenarioBehaviorInstructionTranslationService;
  let behaviorInstructionTranslationService: jest.Mocked<BehaviorInstructionTranslationService>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let translationRepository: jest.Mocked<ScenarioBehaviorInstructionTranslationRepository>;

  const mockInstruction = {
    id: 'instruction-uuid-1',
    instructions: ['Be empathetic', 'Listen carefully'],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as unknown as ScenarioBehaviorInstruction;

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

    const mockTranslationRepository = {
      save: jest.fn(),
      update: jest.fn(),
      getTranslationsByInstructionId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioBehaviorInstructionTranslationService,
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
          provide: ScenarioBehaviorInstructionTranslationRepository,
          useValue: mockTranslationRepository,
        },
      ],
    }).compile();

    service = module.get<ScenarioBehaviorInstructionTranslationService>(
      ScenarioBehaviorInstructionTranslationService,
    );
    behaviorInstructionTranslationService = module.get(
      BehaviorInstructionTranslationService,
    );
    sharedLanguageService = module.get(SharedLanguageService);
    scenarioSharedService = module.get(ScenarioSharedService);
    translationRepository = module.get(
      ScenarioBehaviorInstructionTranslationRepository,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUpdateInstructionTranslations', () => {
    it('should skip when no valid language codes exist', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [],
      );

      await service.createUpdateInstructionTranslations([mockInstruction]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).not.toHaveBeenCalled();
      expect(translationRepository.save).not.toHaveBeenCalled();
    });

    it('should skip when getUniqueLanguagesFromScenarioTranslations returns null', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        null as any,
      );

      await service.createUpdateInstructionTranslations([mockInstruction]);

      expect(sharedLanguageService.getValidLanguages).not.toHaveBeenCalled();
    });

    it('should skip when no valid languages returned from shared language service', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [],
        languagesMap: {} as any,
      });

      await service.createUpdateInstructionTranslations([mockInstruction]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).not.toHaveBeenCalled();
    });

    it('should create new translations when none exist', async () => {
      const joinedInstructions = ['Be empathetic', 'Listen carefully'].join(
        INSTRUCTION_SEPARATOR,
      );

      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });
      behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes.mockResolvedValue(
        {
          es: {
            instructions: `Sea empático${INSTRUCTION_SEPARATOR}Escuche con atención`,
          },
        },
      );
      translationRepository.getTranslationsByInstructionId.mockResolvedValue(
        [],
      );
      translationRepository.save.mockResolvedValue([] as any);

      await service.createUpdateInstructionTranslations([mockInstruction]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).toHaveBeenCalledWith({ instructions: joinedInstructions }, ['es']);
      expect(translationRepository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            scenarioBehaviorInstructionId: 'instruction-uuid-1',
            languageId: 2,
            instructions: ['Sea empático', 'Escuche con atención'],
          }),
        ]),
      );
    });

    it('should update existing translations instead of creating new ones', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });
      behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes.mockResolvedValue(
        {
          es: {
            instructions: `Sea empático actualizado${INSTRUCTION_SEPARATOR}Escuche actualizado`,
          },
        },
      );
      translationRepository.getTranslationsByInstructionId.mockResolvedValue([
        {
          id: 'trans-uuid-1',
          scenarioBehaviorInstructionId: 'instruction-uuid-1',
          languageId: 2,
          instructions: ['Sea empático', 'Escuche con atención'],
        } as any,
      ]);

      await service.createUpdateInstructionTranslations([mockInstruction]);

      expect(translationRepository.update).toHaveBeenCalledWith(
        {
          scenarioBehaviorInstructionId: 'instruction-uuid-1',
          languageId: 2,
        },
        {
          instructions: ['Sea empático actualizado', 'Escuche actualizado'],
        },
      );
      expect(translationRepository.save).not.toHaveBeenCalled();
    });

    it('should create and update in same batch when mix of existing and new languages', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2, 3],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: mockLanguages as any,
        languagesMap: {} as any,
      });
      behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes.mockResolvedValue(
        {
          es: { instructions: `Sea empático` },
          fr: { instructions: `Soyez empathique` },
        },
      );
      translationRepository.getTranslationsByInstructionId.mockResolvedValue([
        {
          id: 'trans-uuid-1',
          scenarioBehaviorInstructionId: 'instruction-uuid-1',
          languageId: 2,
          instructions: ['Old Spanish'],
        } as any,
      ]);
      translationRepository.save.mockResolvedValue([] as any);

      await service.createUpdateInstructionTranslations([mockInstruction]);

      expect(translationRepository.update).toHaveBeenCalledWith(
        {
          scenarioBehaviorInstructionId: 'instruction-uuid-1',
          languageId: 2,
        },
        { instructions: ['Sea empático'] },
      );
      expect(translationRepository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            scenarioBehaviorInstructionId: 'instruction-uuid-1',
            languageId: 3,
            instructions: ['Soyez empathique'],
          }),
        ]),
      );
    });

    it('should skip instructions with empty instructions array', async () => {
      const emptyInstruction = {
        ...mockInstruction,
        instructions: [],
      } as unknown as ScenarioBehaviorInstruction;

      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });

      await service.createUpdateInstructionTranslations([emptyInstruction]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).not.toHaveBeenCalled();
    });

    it('should skip instructions with only whitespace strings', async () => {
      const whitespaceInstruction = {
        ...mockInstruction,
        instructions: ['  ', '', '   '],
      } as unknown as ScenarioBehaviorInstruction;

      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });

      await service.createUpdateInstructionTranslations([
        whitespaceInstruction,
      ]);

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

      await service.createUpdateInstructionTranslations([mockInstruction]);

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
        service.createUpdateInstructionTranslations([mockInstruction]),
      ).resolves.not.toThrow();

      expect(translationRepository.save).not.toHaveBeenCalled();
    });

    it('should skip when translated data has no instructions field', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });
      behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes.mockResolvedValue(
        { es: { someOtherField: 'value' } },
      );
      translationRepository.getTranslationsByInstructionId.mockResolvedValue(
        [],
      );

      await service.createUpdateInstructionTranslations([mockInstruction]);

      expect(translationRepository.save).not.toHaveBeenCalled();
    });

    it('should handle multiple instructions in batch', async () => {
      const secondInstruction = {
        id: 'instruction-uuid-2',
        instructions: ['Stay calm'],
      } as unknown as ScenarioBehaviorInstruction;

      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });
      behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes.mockResolvedValue(
        { es: { instructions: 'Traducción' } },
      );
      translationRepository.getTranslationsByInstructionId.mockResolvedValue(
        [],
      );
      translationRepository.save.mockResolvedValue([] as any);

      await service.createUpdateInstructionTranslations([
        mockInstruction,
        secondInstruction,
      ]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).toHaveBeenCalledTimes(2);
      expect(translationRepository.save).toHaveBeenCalledTimes(2);
    });
  });
});
