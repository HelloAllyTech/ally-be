import { Test, TestingModule } from '@nestjs/testing';
import { LanguageController } from '../language.controller';
import { LanguageService } from '../../service/language.service';
import { CreateLanguagesDto } from '../../dto/create-languages.dto';
import { UpdateLanguageDto } from '../../dto/update-language.dto';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';
import { SortOrder } from 'src/user/enum/user.enum';

describe('LanguageController', () => {
  let controller: LanguageController;
  let languageService: jest.Mocked<LanguageService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LanguageController],
      providers: [
        {
          provide: LanguageService,
          useValue: {
            createLanguages: jest.fn(),
            updateLanguage: jest.fn(),
            getLanguages: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: { checkPermission: jest.fn() },
        },
        {
          provide: UserService,
          useValue: { get: jest.fn() },
        },
        {
          provide: AppConfigService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<LanguageController>(LanguageController);
    languageService = module.get<LanguageService>(
      LanguageService,
    ) as jest.Mocked<LanguageService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLanguages', () => {
    const mockLanguages = [
      {
        id: 1,
        value: 'en-IN',
        label: 'English (India)',
        active: true,
        translationCode: 'en',
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        llmProviderConfig: {},
        sttProviderConfig: {},
      },
      {
        id: 2,
        value: 'hi-IN',
        label: 'Hindi (India)',
        active: true,
        translationCode: 'hi',
        createdAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-02'),
        llmProviderConfig: {},
        sttProviderConfig: {},
      },
      {
        id: 3,
        value: 'es-ES',
        label: 'Spanish (Spain)',
        active: true,
        translationCode: 'es',
        createdAt: new Date('2024-01-03'),
        updatedAt: new Date('2024-01-03'),
        llmProviderConfig: {},
        sttProviderConfig: {},
      },
    ];

    it('should return all languages with default pagination', async () => {
      languageService.getLanguages.mockResolvedValue(mockLanguages);

      const result = await controller.getLanguages();

      expect(languageService.getLanguages).toHaveBeenCalledWith(undefined, {
        limit: undefined,
        offset: undefined,
        sortBy: undefined,
        order: 'ASC',
      });
      expect(result).toEqual(mockLanguages);
    });

    it('should return languages with search filter', async () => {
      const filteredLanguages = [mockLanguages[0]];
      languageService.getLanguages.mockResolvedValue(filteredLanguages);

      const result = await controller.getLanguages(
        undefined,
        undefined,
        undefined,
        undefined,
        'english',
      );

      expect(languageService.getLanguages).toHaveBeenCalledWith('english', {
        limit: undefined,
        offset: undefined,
        sortBy: undefined,
        order: 'ASC',
      });
      expect(result).toEqual(filteredLanguages);
    });

    it('should return languages with pagination', async () => {
      const paginatedLanguages = [mockLanguages[0]];
      languageService.getLanguages.mockResolvedValue(paginatedLanguages);

      const result = await controller.getLanguages(10, 0);

      expect(languageService.getLanguages).toHaveBeenCalledWith(undefined, {
        limit: 10,
        offset: 0,
        sortBy: undefined,
        order: 'ASC',
      });
      expect(result).toEqual(paginatedLanguages);
    });

    it('should return languages sorted by custom field in DESC order', async () => {
      const sortedLanguages = [
        mockLanguages[2],
        mockLanguages[1],
        mockLanguages[0],
      ];
      languageService.getLanguages.mockResolvedValue(sortedLanguages);

      const result = await controller.getLanguages(
        undefined,
        undefined,
        'value',
        SortOrder.DESC,
      );

      expect(languageService.getLanguages).toHaveBeenCalledWith(undefined, {
        limit: undefined,
        offset: undefined,
        sortBy: 'value',
        order: SortOrder.DESC,
      });
      expect(result).toEqual(sortedLanguages);
    });

    it('should return languages with all query parameters', async () => {
      languageService.getLanguages.mockResolvedValue(mockLanguages);

      await controller.getLanguages(20, 10, 'label', SortOrder.ASC, 'hindi');

      expect(languageService.getLanguages).toHaveBeenCalledWith('hindi', {
        limit: 20,
        offset: 10,
        sortBy: 'label',
        order: SortOrder.ASC,
      });
    });

    it('should return empty array when no languages match search', async () => {
      languageService.getLanguages.mockResolvedValue([]);

      const result = await controller.getLanguages(
        undefined,
        undefined,
        undefined,
        undefined,
        'nonexistent',
      );

      expect(result).toEqual([]);
    });

    it('should handle service errors gracefully', async () => {
      const error = new Error('Database error');
      languageService.getLanguages.mockRejectedValue(error);

      await expect(controller.getLanguages()).rejects.toThrow('Database error');
    });
  });

  describe('createLanguage', () => {
    const createLanguagesDto: CreateLanguagesDto = {
      languages: [
        {
          value: 'en-IN',
          label: 'English (India)',
          active: true,
          translationCode: 'en',
          llmProviderConfig: {},
          sttProviderConfig: {},
        },
        {
          value: 'es-ES',
          label: 'Spanish (Spain)',
          active: true,
          translationCode: 'es',
          llmProviderConfig: {},
          sttProviderConfig: {},
        },
      ],
    };

    it('should successfully create languages', async () => {
      const expectedResult = [
        { id: 1, ...createLanguagesDto.languages[0] },
        { id: 2, ...createLanguagesDto.languages[1] },
      ];

      languageService.createLanguages.mockResolvedValue(expectedResult as any);

      const result = await controller.createLanguage(createLanguagesDto);

      expect(languageService.createLanguages).toHaveBeenCalledWith(
        createLanguagesDto,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle empty languages array', async () => {
      const emptyDto: CreateLanguagesDto = { languages: [] };
      languageService.createLanguages.mockResolvedValue([]);

      const result = await controller.createLanguage(emptyDto);

      expect(languageService.createLanguages).toHaveBeenCalledWith(emptyDto);
      expect(result).toEqual([]);
    });
  });

  describe('updateLanguage', () => {
    const updateLanguageDto: UpdateLanguageDto = {
      value: 'en-US',
      label: 'English (United States)',
      active: true,
      translationCode: 'en',
      llmProviderConfig: {},
      sttProviderConfig: {},
    };

    it('should successfully update a language', async () => {
      languageService.updateLanguage.mockResolvedValue(true);

      const result = await controller.updateLanguage(1, updateLanguageDto);

      expect(languageService.updateLanguage).toHaveBeenCalledWith(
        1,
        updateLanguageDto,
      );
      expect(result).toBe(true);
    });

    it('should throw NotFoundException when language is not found', async () => {
      languageService.updateLanguage.mockRejectedValue(
        new Error('Language not found'),
      );

      await expect(
        controller.updateLanguage(999, updateLanguageDto),
      ).rejects.toThrow('Language not found');
    });
  });
});
