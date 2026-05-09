import { Test, TestingModule } from '@nestjs/testing';
import { TooltipTranslationService } from '../tooltip-translation.service';
import { TooltipTranslationsRepository } from '../../repository/tooltip-translations.repository';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { Tooltip } from '../../entity/tooltip.entity';
import { TooltipTranslations } from '../../entity/tooltip-translations.entity';

describe('TooltipTranslationService', () => {
  let service: TooltipTranslationService;
  let translationsRepository: jest.Mocked<TooltipTranslationsRepository>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let openAITranslationService: jest.Mocked<OpenAITranslationsService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;

  const mockTooltip: Tooltip = {
    id: 'tooltip-uuid-1',
    location: 'login_button',
    tipText: 'Click here to log in',
    icon: '😀',
    active: true,
    createdBy: 1,
    updatedBy: 1,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  } as Tooltip;

  const mockLanguages = [
    { id: 2, translationCode: 'es' },
    { id: 3, translationCode: 'fr' },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TooltipTranslationService,
        {
          provide: TooltipTranslationsRepository,
          useValue: {
            getTranslationsByTooltipId: jest.fn(),
            getTranslationsForTooltips: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: SharedLanguageService,
          useValue: { getValidLanguages: jest.fn() },
        },
        {
          provide: OpenAITranslationsService,
          useValue: { translateObjectToLanguages: jest.fn() },
        },
        {
          provide: ScenarioSharedService,
          useValue: { getUniqueLanguagesFromScenarioTranslations: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<TooltipTranslationService>(TooltipTranslationService);
    translationsRepository = module.get(TooltipTranslationsRepository);
    sharedLanguageService = module.get(SharedLanguageService);
    openAITranslationService = module.get(OpenAITranslationsService);
    scenarioSharedService = module.get(ScenarioSharedService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createUpdateTooltipTranslations', () => {
    it('should return early when no valid language codes from scenarios', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue([]);

      await service.createUpdateTooltipTranslations([mockTooltip]);

      expect(sharedLanguageService.getValidLanguages).not.toHaveBeenCalled();
    });

    it('should return early when getValidLanguages returns no languages', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue([2, 3]);
      sharedLanguageService.getValidLanguages.mockResolvedValue({ languages: [] } as any);

      await service.createUpdateTooltipTranslations([mockTooltip]);

      expect(translationsRepository.getTranslationsByTooltipId).not.toHaveBeenCalled();
    });

    it('should persist translations when valid languages and tooltips are provided', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue([2, 3]);
      sharedLanguageService.getValidLanguages.mockResolvedValue({ languages: mockLanguages } as any);
      openAITranslationService.translateObjectToLanguages.mockResolvedValue({
        es: { tipText: 'Haz clic aquí para iniciar sesión' },
        fr: { tipText: 'Cliquez ici pour vous connecter' },
      });
      translationsRepository.getTranslationsByTooltipId.mockResolvedValue([]);
      translationsRepository.save.mockResolvedValue([] as any);

      await service.createUpdateTooltipTranslations([mockTooltip]);

      expect(openAITranslationService.translateObjectToLanguages).toHaveBeenCalledWith(
        { tipText: 'Click here to log in' },
        ['es', 'fr'],
        'openai_translation_tooltip_translation',
      );
      expect(translationsRepository.save).toHaveBeenCalledWith([
        { tooltipId: 'tooltip-uuid-1', languageId: 2, tipText: 'Haz clic aquí para iniciar sesión' },
        { tooltipId: 'tooltip-uuid-1', languageId: 3, tipText: 'Cliquez ici pour vous connecter' },
      ]);
    });

    it('should update existing translations instead of creating duplicates', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue([2]);
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [{ id: 2, translationCode: 'es' }],
      } as any);
      openAITranslationService.translateObjectToLanguages.mockResolvedValue({
        es: { tipText: 'Haz clic aquí para iniciar sesión' },
      });
      const existing: Partial<TooltipTranslations>[] = [
        { tooltipId: 'tooltip-uuid-1', languageId: 2, tipText: 'old text' },
      ];
      translationsRepository.getTranslationsByTooltipId.mockResolvedValue(existing as TooltipTranslations[]);

      await service.createUpdateTooltipTranslations([mockTooltip]);

      expect(translationsRepository.save).not.toHaveBeenCalled();
      expect(translationsRepository.update).toHaveBeenCalledWith(
        { tooltipId: 'tooltip-uuid-1', languageId: 2 },
        { tipText: 'Haz clic aquí para iniciar sesión' },
      );
    });

    it('should skip tooltip when tipText is empty', async () => {
      const emptyTooltip = { ...mockTooltip, tipText: '   ' };
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue([2]);
      sharedLanguageService.getValidLanguages.mockResolvedValue({ languages: mockLanguages } as any);

      await service.createUpdateTooltipTranslations([emptyTooltip]);

      expect(openAITranslationService.translateObjectToLanguages).not.toHaveBeenCalled();
    });

    it('should skip languages with default translation code (en)', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue([1]);
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [{ id: 1, translationCode: 'en' }],
      } as any);

      await service.createUpdateTooltipTranslations([mockTooltip]);

      expect(openAITranslationService.translateObjectToLanguages).not.toHaveBeenCalled();
    });

    it('should handle OpenAI translation failure gracefully', async () => {
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue([2]);
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [{ id: 2, translationCode: 'es' }],
      } as any);
      openAITranslationService.translateObjectToLanguages.mockRejectedValue(new Error('OpenAI error'));
      translationsRepository.getTranslationsByTooltipId.mockResolvedValue([]);

      await expect(service.createUpdateTooltipTranslations([mockTooltip])).resolves.not.toThrow();
      expect(translationsRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getTooltipsWithTranslations', () => {
    it('should return original tooltips when list is empty', async () => {
      const result = await service.getTooltipsWithTranslations([], 2);
      expect(result).toEqual([]);
      expect(translationsRepository.getTranslationsForTooltips).not.toHaveBeenCalled();
    });

    it('should return original tooltips when languageId is 0/falsy', async () => {
      const result = await service.getTooltipsWithTranslations([mockTooltip], 0);
      expect(result).toEqual([mockTooltip]);
      expect(translationsRepository.getTranslationsForTooltips).not.toHaveBeenCalled();
    });

    it('should replace tipText with translated value when translation exists', async () => {
      const translation: Partial<TooltipTranslations> = {
        tooltipId: 'tooltip-uuid-1',
        tipText: 'Haz clic aquí para iniciar sesión',
      };
      translationsRepository.getTranslationsForTooltips.mockResolvedValue(
        [translation] as TooltipTranslations[],
      );

      const result = await service.getTooltipsWithTranslations([mockTooltip], 2);

      expect(result[0].tipText).toBe('Haz clic aquí para iniciar sesión');
    });

    it('should return original tooltip when no translation exists for it', async () => {
      translationsRepository.getTranslationsForTooltips.mockResolvedValue([]);

      const result = await service.getTooltipsWithTranslations([mockTooltip], 2);

      expect(result[0]).toEqual(mockTooltip);
    });

    it('should handle mix of translated and untranslated tooltips', async () => {
      const tooltip2 = { ...mockTooltip, id: 'tooltip-uuid-2', tipText: 'Another tip' };
      const translation: Partial<TooltipTranslations> = {
        tooltipId: 'tooltip-uuid-1',
        tipText: 'Haz clic aquí',
      };
      translationsRepository.getTranslationsForTooltips.mockResolvedValue(
        [translation] as TooltipTranslations[],
      );

      const result = await service.getTooltipsWithTranslations([mockTooltip, tooltip2], 2);

      expect(result[0].tipText).toBe('Haz clic aquí');
      expect(result[1].tipText).toBe('Another tip');
    });
  });
});
