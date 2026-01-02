import { Test, TestingModule } from '@nestjs/testing';
import { SharedLanguageService } from '../shared-language.service';
import { LanguagesRepository } from '../../repository/languages.repository';
import { Languages } from '../../entity/languages.entity';

describe('SharedLanguageService', () => {
  let service: SharedLanguageService;
  let languagesRepository: jest.Mocked<LanguagesRepository>;

  const mockLanguage1: Languages = {
    id: 1,
    value: 'hi-IN',
    label: 'Hindi (India)',
    translationCode: 'hi',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Languages;

  const mockLanguage2: Languages = {
    id: 2,
    value: 'en-IN',
    label: 'English (India)',
    translationCode: 'en',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Languages;

  const mockLanguage3: Languages = {
    id: 3,
    value: 'mr-IN',
    label: 'Marathi (India)',
    translationCode: 'mr',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Languages;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SharedLanguageService,
        {
          provide: LanguagesRepository,
          useValue: {
            getLanguagesById: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SharedLanguageService>(SharedLanguageService);
    languagesRepository = module.get(LanguagesRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLanguagesByIds', () => {
    it('should return languages for the given IDs', async () => {
      const languageIds = [1, 2];
      const expectedLanguages = [mockLanguage1, mockLanguage2];

      languagesRepository.getLanguagesById.mockResolvedValue(expectedLanguages);

      const result = await service.getLanguagesByIds(languageIds);

      expect(result).toEqual(expectedLanguages);
      expect(languagesRepository.getLanguagesById).toHaveBeenCalledWith(
        languageIds,
      );
    });

    it('should return empty array when no IDs are provided', async () => {
      languagesRepository.getLanguagesById.mockResolvedValue([]);

      const result = await service.getLanguagesByIds([]);

      expect(result).toEqual([]);
      expect(languagesRepository.getLanguagesById).toHaveBeenCalledWith([]);
    });
  });

  describe('getValidLanguages', () => {
    it('should return filtered languages excluding English and with language map', async () => {
      const languageIds = [1, 2, 3];
      const allLanguages = [mockLanguage1, mockLanguage2, mockLanguage3];
      const expectedFiltered = [mockLanguage1, mockLanguage3]; // English should be filtered out

      languagesRepository.getLanguagesById.mockResolvedValue(allLanguages);

      const result = await service.getValidLanguages(languageIds);

      expect(result.languages).toEqual(expectedFiltered);
      expect(result.languagesMap).toEqual({
        [mockLanguage1.translationCode]: mockLanguage1,
        [mockLanguage3.translationCode]: mockLanguage3,
      });
      // Should include the default language (id: 2) in the query
      expect(languagesRepository.getLanguagesById).toHaveBeenCalledWith([
        ...languageIds,
      ]);
    });

    it('should handle empty results', async () => {
      const languageIds: number[] = [];
      languagesRepository.getLanguagesById.mockResolvedValue([]);

      const result = await service.getValidLanguages(languageIds);

      expect(result.languages).toEqual([]);
      expect(result.languagesMap).toEqual({});
      expect(languagesRepository.getLanguagesById).toHaveBeenCalledWith([]); // Only the default language ID
    });

    it('should handle when only English is in the results', async () => {
      const languageIds = [2]; // Only English
      languagesRepository.getLanguagesById.mockResolvedValue([mockLanguage2]);

      const result = await service.getValidLanguages(languageIds);

      expect(result.languages).toEqual([]); // English should be filtered out
      expect(result.languagesMap).toEqual({});
    });
  });
});
