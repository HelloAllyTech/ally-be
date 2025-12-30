import { Test, TestingModule } from '@nestjs/testing';
import { LanguagesRepository } from '../../repository/languages.repository';
import { Languages } from '../../entity/languages.entity';
import { LanguageService } from '../language.service';
import { UpdateLanguageDto } from 'src/language/dto/update-language.dto';
import { CreateLanguagesDto } from 'src/language/dto/create-languages.dto';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';

describe('LanguageService', () => {
  let service: LanguageService;

  let languagesRepository: jest.Mocked<Repository<Languages>>;

  const mockLanguages: CreateLanguagesDto = {
    languages: [
      {
        value: 'hi-IN',
        label: 'Hindi (India)',
        translationCode: 'hi',
        active: true,
      },
      {
        value: 'en-IN',
        label: 'English (India)',
        translationCode: 'en',
        active: true,
      },
    ],
  };

  const mockLanguage1: Languages = {
    value: 'hi-IN',
    label: 'Hindi (India)',
    translationCode: 'hi',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    id: 1,
  } as Languages;

  const mockLanguage2: Languages = {
    value: 'en-IN',
    label: 'English (India)',
    translationCode: 'en',
    active: true,
  } as Languages;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LanguageService,
        {
          provide: LanguagesRepository,
          useValue: {
            getLanguagesById: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LanguageService>(LanguageService);
    languagesRepository = module.get(LanguagesRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createLanguages', () => {
    it('should create multiple languages', async () => {
      // Create mock implementations
      const createdLanguages = [
        { ...mockLanguage1, id: 1 },
        { ...mockLanguage2, id: 2 },
      ] as Languages[];

      // Mock the create method to return a new Languages instance
      const mockCreate = jest.fn((lang) => {
        const newLang = new Languages();
        Object.assign(newLang, lang);
        return newLang;
      });

      // Mock the save method to return our test data
      const mockSave = jest.fn().mockResolvedValue(createdLanguages);

      // Apply the mocks
      languagesRepository.create = mockCreate as any;
      languagesRepository.save = mockSave as any;

      // Call the service method
      const result = await service.createLanguages(mockLanguages);

      // Verify the results
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        value: 'hi-IN',
        label: 'Hindi (India)',
        translationCode: 'hi',
        active: true,
      });
      expect(result[1]).toMatchObject({
        value: 'en-IN',
        label: 'English (India)',
        translationCode: 'en',
        active: true,
      });

      // Verify the mocks were called correctly
      expect(languagesRepository.create).toHaveBeenCalledTimes(2);
      expect(languagesRepository.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateLanguage', () => {
    const languageId = 1;
    const updateLanguageDto: UpdateLanguageDto = {
      value: 'mr-IN',
      label: 'Marathi (India)',
      translationCode: 'mr',
      active: true,
    };
    it('should update scenario voice successfully', async () => {
      languagesRepository.findOne.mockResolvedValue(updateLanguageDto as any);
      languagesRepository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.updateLanguage(
        languageId,
        updateLanguageDto,
      );

      expect(result).toBe(true);
    });

    it('should return false when update affects no rows', async () => {
      languagesRepository.findOne.mockResolvedValue(updateLanguageDto as any);
      languagesRepository.update.mockResolvedValue({ affected: 0 } as any);

      const result = await service.updateLanguage(
        languageId,
        updateLanguageDto,
      );

      expect(result).toBe(false);
    });

    it('should throw NotFoundException when voice not found', async () => {
      languagesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateLanguage(languageId, updateLanguageDto),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
