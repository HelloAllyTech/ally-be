import { Test, TestingModule } from '@nestjs/testing';
import { TranscriptTranslationService } from '../transcript-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { GoogleTranslationsService } from 'src/common/service/google-translation.service';
import { RedisService } from 'src/redis/service/redis.service';
import { ScenarioSessionMessageTranslationRepository } from '../../repository/scenario-session-message-translation.repository';

describe('TranscriptTranslationService', () => {
  let service: TranscriptTranslationService;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let openAITranslationsService: jest.Mocked<OpenAITranslationsService>;
  let googleTranslationsService: jest.Mocked<GoogleTranslationsService>;
  let redisService: jest.Mocked<RedisService>;
  let repository: jest.Mocked<ScenarioSessionMessageTranslationRepository>;

  const mockLanguage = { id: 5, translationCode: 'hi' } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranscriptTranslationService,
        {
          provide: SharedLanguageService,
          useValue: { getLanguageByLanguageCode: jest.fn() },
        },
        {
          provide: OpenAITranslationsService,
          useValue: { translateText: jest.fn() },
        },
        {
          provide: GoogleTranslationsService,
          useValue: { translateObjectToLanguages: jest.fn() },
        },
        {
          provide: RedisService,
          useValue: { acquireLock: jest.fn(), releaseLock: jest.fn() },
        },
        {
          provide: ScenarioSessionMessageTranslationRepository,
          useValue: {
            findByMessageIdsAndLanguageId: jest.fn(),
            findOneByMessageIdAndLanguageId: jest.fn(),
            upsertOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(TranscriptTranslationService);
    sharedLanguageService = module.get(SharedLanguageService);
    openAITranslationsService = module.get(OpenAITranslationsService);
    googleTranslationsService = module.get(GoogleTranslationsService);
    redisService = module.get(RedisService);
    repository = module.get(ScenarioSessionMessageTranslationRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('translateMessages', () => {
    it('should return an empty map for an empty message list', async () => {
      const result = await service.translateMessages('scenario', [], 'hi');
      expect(result.size).toBe(0);
      expect(
        sharedLanguageService.getLanguageByLanguageCode,
      ).not.toHaveBeenCalled();
    });

    it('should return an empty map when the languageCode is unknown', async () => {
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(null);

      const result = await service.translateMessages(
        'scenario',
        [{ id: 1, content: 'Hello' }],
        'xx',
      );

      expect(result.size).toBe(0);
    });

    it('should reuse stored translations without calling OpenAI or Google', async () => {
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
        mockLanguage,
      );
      repository.findByMessageIdsAndLanguageId.mockResolvedValue([
        {
          scenarioSessionMessageId: 1,
          languageId: 5,
          content: 'नमस्ते',
        } as any,
      ]);

      const result = await service.translateMessages(
        'scenario',
        [{ id: 1, content: 'Hello' }],
        'hi',
      );

      expect(result.get(1)).toBe('नमस्ते');
      expect(openAITranslationsService.translateText).not.toHaveBeenCalled();
      expect(redisService.acquireLock).not.toHaveBeenCalled();
    });

    it('should translate and persist a missing message via OpenAI when the lock is acquired', async () => {
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
        mockLanguage,
      );
      repository.findByMessageIdsAndLanguageId.mockResolvedValue([]);
      redisService.acquireLock.mockResolvedValue(true);
      repository.findOneByMessageIdAndLanguageId.mockResolvedValue(null);
      openAITranslationsService.translateText.mockResolvedValue('नमस्ते');
      repository.upsertOne.mockResolvedValue({
        scenarioSessionMessageId: 1,
        languageId: 5,
        content: 'नमस्ते',
      } as any);

      const result = await service.translateMessages(
        'scenario',
        [{ id: 1, content: 'Hello' }],
        'hi',
      );

      expect(result.get(1)).toBe('नमस्ते');
      expect(repository.upsertOne).toHaveBeenCalledWith({
        scenarioSessionMessageId: 1,
        languageId: 5,
        content: 'नमस्ते',
      });
      expect(redisService.releaseLock).toHaveBeenCalled();
    });

    it('should fall back to Google translation when OpenAI returns the original text', async () => {
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
        mockLanguage,
      );
      repository.findByMessageIdsAndLanguageId.mockResolvedValue([]);
      redisService.acquireLock.mockResolvedValue(true);
      repository.findOneByMessageIdAndLanguageId.mockResolvedValue(null);
      openAITranslationsService.translateText.mockResolvedValue('Hello');
      googleTranslationsService.translateObjectToLanguages.mockResolvedValue({
        hi: { text: 'नमस्ते' },
      });
      repository.upsertOne.mockResolvedValue({
        scenarioSessionMessageId: 1,
        languageId: 5,
        content: 'नमस्ते',
      } as any);

      const result = await service.translateMessages(
        'scenario',
        [{ id: 1, content: 'Hello' }],
        'hi',
      );

      expect(result.get(1)).toBe('नमस्ते');
      expect(repository.upsertOne).toHaveBeenCalledWith({
        scenarioSessionMessageId: 1,
        languageId: 5,
        content: 'नमस्ते',
      });
    });

    it('should wait for and reuse the row written by the request holding the lock', async () => {
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
        mockLanguage,
      );
      repository.findByMessageIdsAndLanguageId.mockResolvedValue([]);
      redisService.acquireLock.mockResolvedValue(false);
      repository.findOneByMessageIdAndLanguageId.mockResolvedValue({
        scenarioSessionMessageId: 1,
        languageId: 5,
        content: 'नमस्ते',
      } as any);

      const result = await service.translateMessages(
        'scenario',
        [{ id: 1, content: 'Hello' }],
        'hi',
      );

      expect(result.get(1)).toBe('नमस्ते');
      expect(openAITranslationsService.translateText).not.toHaveBeenCalled();
    });

    it('should skip messages with empty content', async () => {
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
        mockLanguage,
      );
      repository.findByMessageIdsAndLanguageId.mockResolvedValue([]);

      const result = await service.translateMessages(
        'scenario',
        [{ id: 1, content: '   ' }],
        'hi',
      );

      expect(result.size).toBe(0);
      expect(redisService.acquireLock).not.toHaveBeenCalled();
    });
  });
});
