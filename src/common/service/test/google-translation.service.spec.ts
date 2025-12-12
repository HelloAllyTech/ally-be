import { Test, TestingModule } from '@nestjs/testing';
import { GoogleTranslationsService } from '../google-translation.service';
import { TranslationServiceClient } from '@google-cloud/translate';
import { LoggerService } from 'src/logger/logger.service';

describe('GoogleTranslationsService', () => {
  let service: GoogleTranslationsService;
  let mockTranslationClient: jest.Mocked<Partial<TranslationServiceClient>> & {
    translateText: jest.Mock;
    locationPath: jest.Mock;
  };
  let mockLogger: jest.Mocked<Partial<LoggerService>> & {
    error: jest.Mock;
    getInstance: jest.Mock;
  };

  beforeEach(async () => {
    // Mock the TranslationServiceClient
    mockTranslationClient = {
      translateText: jest.fn(),
      locationPath: jest
        .fn()
        .mockImplementation(
          (projectId: string, location: string) =>
            `projects/${projectId}/locations/${location}`,
        ),
    };

    // Mock LoggerService
    mockLogger = {
      getInstance: jest.fn().mockReturnThis(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleTranslationsService,
        {
          provide: TranslationServiceClient,
          useValue: mockTranslationClient,
        },
        {
          provide: LoggerService,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<GoogleTranslationsService>(GoogleTranslationsService);
    // Override the client with our mock
    (service as any).client = mockTranslationClient;
    (service as any).projectId = 'test-project';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('translateObjectToLanguages', () => {
    // Update the test for translateObjectToLanguages
    it('should translate object fields to multiple languages', async () => {
      const sourceObject = {
        greeting: 'Hello',
        nested: { message: 'Welcome' },
      };

      // Mock the translation service to return the expected format
      mockTranslationClient.translateText = jest
        .fn()
        .mockResolvedValueOnce([
          {
            translations: [
              { translatedText: 'Hola' },
              { translatedText: 'Bienvenido' },
            ],
          },
        ])
        .mockResolvedValueOnce([
          {
            translations: [
              { translatedText: 'Bonjour' },
              { translatedText: 'Bienvenue' },
            ],
          },
        ]);

      const result = await service.translateObjectToLanguages(sourceObject, [
        'es',
        'fr',
      ]);

      // Verify the structure of the result
      expect(result).toEqual({
        es: {
          greeting: 'Hola',
          nested: { message: 'Bienvenido' },
        },
        fr: {
          greeting: 'Bonjour',
          nested: { message: 'Bienvenue' },
        },
      });
    });

    it('should handle empty object', async () => {
      const result = await service.translateObjectToLanguages({}, ['es', 'fr']);
      expect(result).toEqual({ es: {}, fr: {} });
    });

    it('should handle arrays in the object', async () => {
      const sourceObject = {
        messages: ['Hello', 'Goodbye'],
      };

      mockTranslationClient.translateText = jest.fn().mockResolvedValueOnce([
        {
          translations: [
            { translatedText: 'Hola' },
            { translatedText: 'Adiós' },
          ],
        },
      ]);

      const result = await service.translateObjectToLanguages(sourceObject, [
        'es',
      ]);

      expect(result.es).toEqual({
        messages: ['Hola', 'Adiós'],
      });
    });

    it('should respect chunk size', async () => {
      const sourceObject = {
        text1: 'Hello',
        text2: 'World',
        text3: 'Again',
      };

      // Mock to return translations in chunks
      mockTranslationClient.translateText = jest
        .fn()
        .mockResolvedValueOnce([
          {
            translations: [
              { translatedText: 'Hola' },
              { translatedText: 'Mundo' },
            ],
          },
        ])
        .mockResolvedValueOnce([
          {
            translations: [{ translatedText: 'Otra vez' }],
          },
        ]);

      await service.translateObjectToLanguages(sourceObject, ['es'], {
        chunkSize: 2,
      });

      // Should be called twice due to chunk size of 2 with 3 strings
      expect(mockTranslationClient.translateText).toHaveBeenCalledTimes(2);
    });
  });

  describe('chunkArray', () => {
    it('should split array into chunks of specified size', () => {
      const array = [1, 2, 3, 4, 5];
      const result = (service as any).chunkArray(array, 2);
      expect(result).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('should return empty array for empty input', () => {
      const result = (service as any).chunkArray([], 2);
      expect(result).toEqual([]);
    });
  });
});
