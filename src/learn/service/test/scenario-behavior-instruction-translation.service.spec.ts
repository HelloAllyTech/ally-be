import { Test, TestingModule } from '@nestjs/testing';
import { ScenarioBehaviorInstructionTranslationService } from '../scenario-behavior-instruction-translation.service';
import { BehaviorInstructionTranslationService } from '../behavior-instruction-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from '../scenario-shared.service';
import { ScenarioBehaviorInstructionTranslationRepository } from '../../repository/scenario-behavior-instruction-translation.repository';
import { ScenarioBehaviorInstruction } from '../../entity/scenario-behavior-instruction.entity';

describe('ScenarioBehaviorInstructionTranslationService', () => {
  let service: ScenarioBehaviorInstructionTranslationService;
  let behaviorInstructionTranslationService: jest.Mocked<BehaviorInstructionTranslationService>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let translationRepository: jest.Mocked<ScenarioBehaviorInstructionTranslationRepository>;

  const mockStateInstructionsSource = [
    { stateId: '1', instruction: 'Be empathetic' },
    { stateId: '2', instruction: 'Listen carefully' },
  ];

  const mockInstruction = {
    id: 'instruction-uuid-1',
    stateInstructions: mockStateInstructionsSource,
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
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [mockLanguages[0]] as any,
        languagesMap: {} as any,
      });
      const translatedStateInstructions = [
        { stateId: '1', instruction: 'Sea empático' },
        { stateId: '2', instruction: 'Escuche con atención' },
      ];
      behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes.mockResolvedValue(
        {
          es: {
            stateInstructions: translatedStateInstructions,
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
      ).toHaveBeenCalledWith(
        { stateInstructions: mockStateInstructionsSource },
        ['es'],
      );
      expect(translationRepository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            scenarioBehaviorInstructionId: 'instruction-uuid-1',
            languageId: 2,
            stateInstructions: translatedStateInstructions,
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
            stateInstructions: [
              { stateId: '1', instruction: 'Sea empático actualizado' },
              { stateId: '2', instruction: 'Escuche actualizado' },
            ],
          },
        },
      );
      translationRepository.getTranslationsByInstructionId.mockResolvedValue([
        {
          id: 'trans-uuid-1',
          scenarioBehaviorInstructionId: 'instruction-uuid-1',
          languageId: 2,
          stateInstructions: [
            { stateId: '1', instruction: 'Sea empático' },
            { stateId: '2', instruction: 'Escuche con atención' },
          ],
        } as any,
      ]);

      await service.createUpdateInstructionTranslations([mockInstruction]);

      expect(
        behaviorInstructionTranslationService.buildTranslatedMetadataForLanguageCodes,
      ).toHaveBeenCalled();
      expect(translationRepository.save).not.toHaveBeenCalled();
      expect(translationRepository.update).not.toHaveBeenCalled();
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
          es: {
            stateInstructions: [{ stateId: '1', instruction: 'Sea empático' }],
          },
          fr: {
            stateInstructions: [
              { stateId: '1', instruction: 'Soyez empathique' },
            ],
          },
        },
      );
      translationRepository.getTranslationsByInstructionId.mockResolvedValue([
        {
          id: 'trans-uuid-1',
          scenarioBehaviorInstructionId: 'instruction-uuid-1',
          languageId: 2,
          stateInstructions: [{ stateId: '1', instruction: 'Old Spanish' }],
        } as any,
      ]);
      translationRepository.save.mockResolvedValue([] as any);

      await service.createUpdateInstructionTranslations([mockInstruction]);

      expect(translationRepository.update).not.toHaveBeenCalled();
      expect(translationRepository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            scenarioBehaviorInstructionId: 'instruction-uuid-1',
            languageId: 3,
            stateInstructions: [
              { stateId: '1', instruction: 'Soyez empathique' },
            ],
          }),
        ]),
      );
    });

    it('should skip instructions with empty instructions array', async () => {
      const emptyInstruction = {
        ...mockInstruction,
        stateInstructions: [],
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
        stateInstructions: [
          { stateId: '1', instruction: '  ' },
          { stateId: '2', instruction: '' },
        ],
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

    it('should skip when translated data has no stateInstructions field', async () => {
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
        stateInstructions: [{ stateId: '1', instruction: 'Stay calm' }],
      } as unknown as ScenarioBehaviorInstruction;

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
            stateInstructions: [{ stateId: '1', instruction: 'Traducción' }],
          },
        },
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
