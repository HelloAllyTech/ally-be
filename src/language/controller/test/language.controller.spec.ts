import { Test, TestingModule } from '@nestjs/testing';
import { LanguageController } from '../language.controller';
import { LanguageService } from '../../service/language.service';
import { CreateLanguagesDto } from '../../dto/create-languages.dto';
import { UpdateLanguageDto } from '../../dto/update-language.dto';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { UserService } from 'src/user/service/user.service';
import { AppConfigService } from 'src/config/config.service';

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

  describe('createLanguage', () => {
    const createLanguagesDto: CreateLanguagesDto = {
      languages: [
        {
          value: 'en-IN',
          label: 'English (India)',
          active: true,
          translationCode: 'en',
        },
        {
          value: 'es-ES',
          label: 'Spanish (Spain)',
          active: true,
          translationCode: 'es',
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
