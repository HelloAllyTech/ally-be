import { Test, TestingModule } from '@nestjs/testing';
import { In } from 'typeorm';
import { ScenarioSharedService } from '../scenario-shared.service';
import { ScenariosRepository } from '../../repository/scenario.repository';
import { ScenarioVersionRepository } from '../../repository/scenario-version.repository';
import { ScenarioSessionRepository } from '../../repository/scenario-session.repository';
import { Scenarios } from '../../entity/scenarios.entity';
import { ScenarioSessions } from '../../entity/scenario-sessions.entity';
import { ScenarioStatus } from '../../type/scenario.type';
import { ScenarioFilters } from 'src/learn/type/scenario-filter.type';
import { ScenarioTranslationsRepository } from 'src/learn/repository/scenario-translations.repository';
import { ScenarioSessionMessagesRepository } from '../../repository/scenario-session-messages.repository';
import { ScenarioSessionDetailsRepository } from '../../repository/scenario-session-details.repository';
import { ScenarioSessionMessageTagsRepository } from '../../repository/scenario-session-message-tags.repository';
import { ScenarioSessionTagCategory } from '../../enum/scenario-session-tag-category.enum';
import { ScenarioVoicesRepository } from '../../repository/scenario-voices.repository';
import { SttConfigsRepository } from '../../repository/stt-configs.repository';
import { LlmConfigsRepository } from '../../repository/llm-configs.repository';
import { LlmModelsRepository } from 'src/llm/repository/llm-models.repository';
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';
import { SessionEventDetectionType } from 'src/session-event/enum/session-event-detection.enum';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { NotFoundException } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import { ScenarioBehaviorInstructionRepository } from '../../repository/scenario-behavior-instruction.repository';
import { ScenarioBehaviorInstructionBehaviorRepository } from '../../repository/scenario-behavior-instruction-behavior.repository';
import { BehaviorRepository } from '../../repository/behavior.repository';
import { ConversationalGuardrailsService } from 'src/conversational-guardrails/service/conversational-guardrails.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { PromptTranslationService } from 'src/prompt/service/prompt-translation.service';
import { LanguageGlossaryService } from 'src/language/service/language-glossary.service';
import { ALLY_AI_LEARN_PROMPT_PREFIX } from '../../constants/scenario-session.constants';
import { CompetencyService } from '../competency.service';
import { AppConfigService } from 'src/config/config.service';
import { S3Service } from 'src/aws/service/s3.service';
import { ScenarioSessionRecordingRepository } from '../../repository/scenario-session-recording.repository';
import { ScenarioSessionRecording } from '../../entity/scenario-session-recording.entity';

describe('ScenarioSharedService', () => {
  let service: ScenarioSharedService;
  let scenariosRepository: jest.Mocked<ScenariosRepository>;
  let scenarioSessionRepository: jest.Mocked<ScenarioSessionRepository>;
  let scenarioTranslationsRepository: jest.Mocked<ScenarioTranslationsRepository>;
  let scenarioSessionMessagesRepository: jest.Mocked<ScenarioSessionMessagesRepository>;
  let scenarioSessionMessageTagsRepository: jest.Mocked<ScenarioSessionMessageTagsRepository>;
  let scenarioSessionDetailsRepository: jest.Mocked<ScenarioSessionDetailsRepository>;
  let scenarioVoiceRepository: jest.Mocked<ScenarioVoicesRepository>;
  let sessionEventSharedService: jest.Mocked<SessionEventSharedService>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let scenarioBehaviorInstructionRepository: jest.Mocked<ScenarioBehaviorInstructionRepository>;
  let scenarioBehaviorInstructionBehaviorRepository: jest.Mocked<ScenarioBehaviorInstructionBehaviorRepository>;
  let behaviorRepository: jest.Mocked<BehaviorRepository>;
  let promptSharedService: jest.Mocked<PromptSharedService>;
  let scenarioSessionRecordingRepository: jest.Mocked<ScenarioSessionRecordingRepository>;

  const mockScenarios: Scenarios[] = [
    { id: 1, title: 'Scenario 1', status: ScenarioStatus.ACTIVE } as Scenarios,
    { id: 2, title: 'Scenario 2', status: ScenarioStatus.ACTIVE } as Scenarios,
    { id: 3, title: 'Scenario 3', status: ScenarioStatus.DRAFT } as Scenarios,
  ];

  const mockScenarioSession: ScenarioSessions = {
    id: 'session-1',
    scenarioId: 1,
    counselorId: 123,
  } as ScenarioSessions;

  beforeEach(async () => {
    const mockScenariosRepo = {
      findBy: jest.fn(),
      findOne: jest.fn(),
      getAdminScenarioById: jest.fn(),
    };

    const mockScenarioSessionRepo = {
      findOne: jest.fn(),
    };

    const mockScenarioBehaviorInstructionRepository = {
      getByScenarioId: jest.fn().mockResolvedValue([]),
    };

    const mockScenarioBehaviorInstructionBehaviorRepository = {
      getByInstructionIds: jest.fn(),
    };

    const mockBehaviorRepository = {
      getBehaviorsByIds: jest.fn(),
    };

    const mockConversationalGuardrailsService = {
      getGuardrailsByScenarioId: jest.fn(),
      getRandomGuardrailsForSession: jest.fn().mockResolvedValue({
        prompt: '',
        items: [],
      }),
    };

    const mockPromptSharedService = {
      getPromptsByOptions: jest.fn().mockResolvedValue([]),
    };

    const mockPromptTranslationService = {
      // By default, pass English bodies through unchanged (new {body} shape).
      overlayTranslations: jest
        .fn()
        .mockImplementation((byCode: Record<string, string>) =>
          Object.fromEntries(
            Object.entries(byCode).map(([code, body]) => [code, { body }]),
          ),
        ),
    };

    const mockLanguageGlossaryService = {
      // By default, no published glossary — sessions serve without it.
      resolveTier0Glossary: jest.fn().mockResolvedValue(''),
      resolveTier1Sections: jest.fn().mockResolvedValue([]),
      resolveGlossaryMeta: jest.fn().mockResolvedValue(null),
    };

    const mockCompetencyService = {
      validateCompetencyId: jest.fn(),
      getCompetency: jest.fn(),
      getCompetencies: jest.fn(),
      createCompetency: jest.fn(),
    };

    const mockAppConfigService = {
      livekit: { environment: 'development' },
      s3: { assetsBucket: 'test-assets-bucket' },
      aws: { region: 'us-east-1' },
    };

    const mockS3Service = {
      getS3Url: jest.fn((bucket: string, region: string, path: string) => {
        const key = path.replace(/^\//, '');
        return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
      }),
    };

    const mockScenarioSessionRecordingRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockScenarioTranslationsRepository = {
      getUniqueLanguagesFromScenarioTranslations: jest.fn(),
      getScenarioTranslationsByScenarioId: jest.fn().mockResolvedValue([]),
    };

    const mockScenarioSessionMessagesRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      getMessagesByScenarioSessionId: jest.fn(),
    };

    const mockScenarioSessionDetailsRepository = {
      findOne: jest.fn(),
    };

    const mockScenarioSessionMessageTagsRepository = {
      getTagsByMessageIds: jest.fn().mockResolvedValue(new Map()),
    };

    const mockScenarioVoicesRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    // Empty registry: every language falls through to its own default, which is
    // the behaviour these room-metadata assertions were written against.
    const mockSttConfigsRepository = {
      findMapByIds: jest.fn().mockResolvedValue(new Map()),
      listConfigs: jest.fn().mockResolvedValue([]),
    };

    const mockLlmConfigsRepository = {
      findMapByIds: jest.fn().mockResolvedValue(new Map()),
      listConfigs: jest.fn().mockResolvedValue([]),
    };
    // Catalog rung: languages now point at an llm_models row ahead of the
    // llm_configs one.
    const mockLlmModelsRepository = {
      findMapByIds: jest.fn().mockResolvedValue(new Map()),
      listModels: jest.fn().mockResolvedValue([]),
    };

    const mockSessionEventSharedService = {
      getSessionEventsByScenarioId: jest.fn(),
      getSessionEventsTranslationsByScenarioId: jest.fn(),
      findByIds: jest.fn(),
      findSessionEventById: jest.fn(),
    };

    const mockSharedLanguageService = {
      getValidLanguages: jest.fn(),
      getLanguagesByIds: jest.fn(),
      getLanguageByLanguageCode: jest.fn(),
      getLanguageByValue: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSharedService,
        {
          provide: ScenariosRepository,
          useValue: mockScenariosRepo,
        },
        {
          provide: ScenarioVersionRepository,
          useValue: { findOne: jest.fn() },
        },
        {
          provide: ScenarioSessionRepository,
          useValue: mockScenarioSessionRepo,
        },
        {
          provide: ScenarioTranslationsRepository,
          useValue: mockScenarioTranslationsRepository,
        },
        {
          provide: ScenarioSessionMessagesRepository,
          useValue: mockScenarioSessionMessagesRepository,
        },
        {
          provide: ScenarioSessionDetailsRepository,
          useValue: mockScenarioSessionDetailsRepository,
        },
        {
          provide: ScenarioSessionMessageTagsRepository,
          useValue: mockScenarioSessionMessageTagsRepository,
        },
        {
          provide: ScenarioVoicesRepository,
          useValue: mockScenarioVoicesRepository,
        },
        {
          provide: SttConfigsRepository,
          useValue: mockSttConfigsRepository,
        },
        {
          provide: LlmConfigsRepository,
          useValue: mockLlmConfigsRepository,
        },
        {
          provide: LlmModelsRepository,
          useValue: mockLlmModelsRepository,
        },
        {
          provide: SessionEventSharedService,
          useValue: mockSessionEventSharedService,
        },
        {
          provide: SharedLanguageService,
          useValue: mockSharedLanguageService,
        },
        {
          provide: ScenarioBehaviorInstructionRepository,
          useValue: mockScenarioBehaviorInstructionRepository,
        },
        {
          provide: ScenarioBehaviorInstructionBehaviorRepository,
          useValue: mockScenarioBehaviorInstructionBehaviorRepository,
        },
        {
          provide: BehaviorRepository,
          useValue: mockBehaviorRepository,
        },
        {
          provide: ConversationalGuardrailsService,
          useValue: mockConversationalGuardrailsService,
        },
        {
          provide: PromptSharedService,
          useValue: mockPromptSharedService,
        },
        {
          provide: PromptTranslationService,
          useValue: mockPromptTranslationService,
        },
        {
          provide: LanguageGlossaryService,
          useValue: mockLanguageGlossaryService,
        },
        {
          provide: CompetencyService,
          useValue: mockCompetencyService,
        },
        {
          provide: AppConfigService,
          useValue: mockAppConfigService,
        },
        {
          provide: S3Service,
          useValue: mockS3Service,
        },
        {
          provide: ScenarioSessionRecordingRepository,
          useValue: mockScenarioSessionRecordingRepository,
        },
      ],
    }).compile();

    service = module.get<ScenarioSharedService>(ScenarioSharedService);
    scenariosRepository = module.get(ScenariosRepository);
    scenarioSessionRepository = module.get(ScenarioSessionRepository);
    scenarioTranslationsRepository = module.get(ScenarioTranslationsRepository);
    scenarioSessionMessagesRepository = module.get(
      ScenarioSessionMessagesRepository,
    );
    scenarioSessionMessageTagsRepository = module.get(
      ScenarioSessionMessageTagsRepository,
    );
    scenarioSessionDetailsRepository = module.get(
      ScenarioSessionDetailsRepository,
    );
    scenarioVoiceRepository = module.get(ScenarioVoicesRepository);
    sessionEventSharedService = module.get(SessionEventSharedService);
    sharedLanguageService = module.get(SharedLanguageService);
    scenarioBehaviorInstructionRepository = module.get(
      ScenarioBehaviorInstructionRepository,
    );
    scenarioBehaviorInstructionBehaviorRepository = module.get(
      ScenarioBehaviorInstructionBehaviorRepository,
    );
    behaviorRepository = module.get(BehaviorRepository);
    promptSharedService = module.get(PromptSharedService);
    scenarioSessionRecordingRepository = module.get(
      ScenarioSessionRecordingRepository,
    );

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getScenarioByIds', () => {
    it('should return scenarios when IDs exist (no filters)', async () => {
      const scenarioIds = [1, 2, 3];
      scenariosRepository.findBy.mockResolvedValue(mockScenarios);

      const result = await service.getScenarioByIds(scenarioIds);

      expect(result).toEqual(mockScenarios);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
      });
    });

    it('should apply status filter when provided', async () => {
      const scenarioIds = [1, 2];
      const filters: ScenarioFilters = {
        status: ScenarioStatus.ACTIVE,
      };
      const filteredScenarios = mockScenarios.filter(
        (s) => s.status === ScenarioStatus.ACTIVE,
      );
      scenariosRepository.findBy.mockResolvedValue(filteredScenarios);

      const result = await service.getScenarioByIds(scenarioIds, filters);

      expect(result).toEqual(filteredScenarios);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
        status: In([ScenarioStatus.ACTIVE]),
      });
    });

    it('should return empty array when repository returns none', async () => {
      const scenarioIds = [999];
      scenariosRepository.findBy.mockResolvedValue([]);

      const result = await service.getScenarioByIds(scenarioIds);

      expect(result).toEqual([]);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
      });
    });

    it('should not include status filter when filters.status is not provided', async () => {
      const scenarioIds = [1, 2];
      scenariosRepository.findBy.mockResolvedValue(mockScenarios);

      const result = await service.getScenarioByIds(scenarioIds, {});

      expect(result).toEqual(mockScenarios);
      expect(scenariosRepository.findBy).toHaveBeenCalledWith({
        id: In(scenarioIds),
      });
    });
  });

  describe('getScenarioSessionById', () => {
    it('should return scenario session when found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);

      const result = await service.getScenarioSessionById('session-1');

      expect(result).toEqual(mockScenarioSession);
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });

    it('should return null when scenario session not found', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSessionById('non-existent-id');

      expect(result).toBeNull();
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
      });
    });
  });

  describe('getScenarioById', () => {
    it('should return scenario when found', async () => {
      const mockScenario = mockScenarios[0];
      scenariosRepository.findOne.mockResolvedValue(mockScenario);

      const result = await service.getScenarioById(1);

      expect(result).toEqual(mockScenario);
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should return null when scenario not found', async () => {
      scenariosRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioById(999);

      expect(result).toBeNull();
      expect(scenariosRepository.findOne).toHaveBeenCalledWith({
        where: { id: 999 },
      });
    });
  });

  describe('getMessagesByScenarioSessionId', () => {
    const sessionId = 'session-123';
    const pagination = { limit: 10, offset: 0 };
    const mockMessages = [
      { id: 1, content: 'msg1', scenarioSessionId: sessionId } as any,
      { id: 2, content: 'msg2', scenarioSessionId: sessionId } as any,
    ];
    const mockTagsMap = new Map<
      number,
      { tagId: string; label: string; category: ScenarioSessionTagCategory }[]
    >([
      [
        1,
        [
          {
            tagId: 'tag-1',
            label: 'reflection',
            category: ScenarioSessionTagCategory.POSITIVE,
          },
        ],
      ],
      [2, []],
    ]);

    it('should fetch and attach tags when includeTags is true', async () => {
      scenarioSessionMessagesRepository.getMessagesByScenarioSessionId.mockResolvedValue(
        [mockMessages, 2],
      );
      scenarioSessionMessageTagsRepository.getTagsByMessageIds.mockResolvedValue(
        mockTagsMap,
      );

      const result = await service.getMessagesByScenarioSessionId(
        sessionId,
        pagination,
        { includeTags: true },
      );

      expect(
        scenarioSessionMessageTagsRepository.getTagsByMessageIds,
      ).toHaveBeenCalledWith(sessionId, [1, 2]);
      expect(result.count).toBe(2);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].tags).toEqual([
        {
          tagId: 'tag-1',
          label: 'reflection',
          category: ScenarioSessionTagCategory.POSITIVE,
        },
      ]);
      expect(result.messages[1].tags).toEqual([]);
    });

    it('should not call getTagsByMessageIds when includeTags is false', async () => {
      scenarioSessionMessagesRepository.getMessagesByScenarioSessionId.mockResolvedValue(
        [mockMessages, 2],
      );

      const result = await service.getMessagesByScenarioSessionId(
        sessionId,
        pagination,
        { includeTags: false },
      );

      expect(
        scenarioSessionMessageTagsRepository.getTagsByMessageIds,
      ).not.toHaveBeenCalled();
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).not.toHaveProperty('tags');
      expect(result.messages[1]).not.toHaveProperty('tags');
    });
  });

  describe('getUniqueLanguagesFromScenarioTranslations', () => {
    it('should return unique language IDs from scenario translations', async () => {
      // Mock the repository method
      scenarioTranslationsRepository.getUniqueLanguagesFromScenarioTranslations =
        jest.fn().mockResolvedValue([1, 2, 3]);

      const result = await service.getUniqueLanguagesFromScenarioTranslations();

      expect(result).toEqual([1, 2, 3]);
      expect(
        scenarioTranslationsRepository.getUniqueLanguagesFromScenarioTranslations,
      ).toHaveBeenCalled();
    });

    it('should return an empty array when no translations exist', async () => {
      scenarioTranslationsRepository.getUniqueLanguagesFromScenarioTranslations =
        jest.fn().mockResolvedValue([]);

      const result = await service.getUniqueLanguagesFromScenarioTranslations();

      expect(result).toEqual([]);
    });

    it('should handle repository errors gracefully', async () => {
      const error = new Error('Database error');
      scenarioTranslationsRepository.getUniqueLanguagesFromScenarioTranslations =
        jest.fn().mockRejectedValue(error);

      await expect(
        service.getUniqueLanguagesFromScenarioTranslations(),
      ).rejects.toThrow('Database error');
    });
  });

  describe('getScenarioSessionForUser', () => {
    it('should find session by id and counselorId (userId)', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(mockScenarioSession);

      const result = await service.getScenarioSessionForUser('session-1', 123);

      expect(result).toEqual(mockScenarioSession);
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'session-1', counselorId: 123 },
      });
    });

    it('should return null when no session found for user', async () => {
      scenarioSessionRepository.findOne.mockResolvedValue(null);

      const result = await service.getScenarioSessionForUser('session-1', 999);

      expect(result).toBeNull();
    });
  });

  describe('getSessionGlimpseByScenarioSessionId', () => {
    it('should throw NotFoundException when scenario session details not found', async () => {
      scenarioSessionDetailsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getSessionGlimpseByScenarioSessionId('session-123'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getSessionGlimpseByScenarioSessionId('session-123'),
      ).rejects.toThrow('Scenario session details not found');
    });

    it('should return sessionGlimpse from summary.feedback when details exist', async () => {
      const glimpse = 'Client showed improvement in reflection skills';
      scenarioSessionDetailsRepository.findOne.mockResolvedValue({
        scenarioSessionId: 'session-123',
        summary: {
          feedback: { sessionGlimpse: glimpse },
        },
      } as any);

      const result =
        await service.getSessionGlimpseByScenarioSessionId('session-123');

      expect(result).toBe(glimpse);
    });

    it('should return null when summary or feedback is missing', async () => {
      scenarioSessionDetailsRepository.findOne.mockResolvedValue({
        scenarioSessionId: 'session-123',
        summary: null,
      } as any);

      const result =
        await service.getSessionGlimpseByScenarioSessionId('session-123');

      expect(result).toBeUndefined();
    });
  });

  describe('getScenarioVoice', () => {
    it('should throw NotFoundException when voice not found', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue(null);

      await expect(service.getScenarioVoice('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getScenarioVoice('invalid-id')).rejects.toThrow(
        'Scenario voice not found',
      );
    });

    it('should return voice when found', async () => {
      const mockVoice = {
        id: 'voice-1',
        name: 'Test Voice',
        voiceId: 'openai-123',
      } as any;
      scenarioVoiceRepository.findOne.mockResolvedValue(mockVoice);

      const result = await service.getScenarioVoice('voice-1');

      expect(result).toEqual(mockVoice);
      expect(scenarioVoiceRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'voice-1' },
      });
    });
  });

  describe('getLanguageDetailsForScenarioSession', () => {
    it('should return enLanguageDetails and null languageDetails when languageId is undefined', async () => {
      const enDetails = { id: 1, value: 'en' };
      sharedLanguageService.getLanguageByValue.mockResolvedValue(
        enDetails as any,
      );

      const result =
        await service.getLanguageDetailsForScenarioSession(undefined);

      expect(result).toEqual({
        enLanguageDetails: enDetails,
        languageDetails: null,
      });
      expect(sharedLanguageService.getLanguagesByIds).not.toHaveBeenCalled();
    });

    it('should return languageDetails when languageId provided and found', async () => {
      const enDetails = { id: 1, value: 'en' };
      const langDetails = { id: 2, value: 'es-ES' };
      sharedLanguageService.getLanguageByValue.mockResolvedValue(
        enDetails as any,
      );
      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        langDetails,
      ] as any);

      const result = await service.getLanguageDetailsForScenarioSession(2);

      expect(result.enLanguageDetails).toEqual(enDetails);
      expect(result.languageDetails).toEqual(langDetails);
      expect(sharedLanguageService.getLanguagesByIds).toHaveBeenCalledWith([2]);
    });

    it('should return null languageDetails when getLanguagesByIds returns empty', async () => {
      const enDetails = { id: 1, value: 'en' };
      sharedLanguageService.getLanguageByValue.mockResolvedValue(
        enDetails as any,
      );
      sharedLanguageService.getLanguagesByIds.mockResolvedValue([]);

      const result = await service.getLanguageDetailsForScenarioSession(99);

      expect(result.languageDetails).toBeNull();
    });
  });

  describe('getAdminScenario', () => {
    it('should throw NotFoundException when scenario not found', async () => {
      scenariosRepository.getAdminScenarioById.mockResolvedValue(null);

      await expect(service.getAdminScenario(999)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getAdminScenario(999)).rejects.toThrow(
        'Scenario not found',
      );
    });

    it('should enrich termination events with event name from session event', async () => {
      const scenarioResult = {
        id: 1,
        title: 'Test',
        terminationEvents: [
          { eventId: 'evt-1', message: 'End' },
          { eventId: 'evt-2' },
        ],
      } as any;
      scenariosRepository.getAdminScenarioById.mockResolvedValue(
        scenarioResult,
      );
      sessionEventSharedService.findSessionEventById
        .mockResolvedValueOnce({ id: 'evt-1', name: 'Termination 1' } as any)
        .mockResolvedValueOnce({ id: 'evt-2', name: 'Termination 2' } as any);
      sharedLanguageService.getLanguageByValue.mockResolvedValue({
        id: 1,
      } as any);

      const result = await service.getAdminScenario(1);

      expect(result.terminationEvents).toHaveLength(2);
      expect(result.terminationEvents![0]).toMatchObject({
        eventId: 'evt-1',
        message: 'End',
        name: 'Termination 1',
      });
      expect(result.terminationEvents![1].name).toBe('Termination 2');
      expect(
        sessionEventSharedService.findSessionEventById,
      ).toHaveBeenCalledWith('evt-1');
      expect(
        sessionEventSharedService.findSessionEventById,
      ).toHaveBeenCalledWith('evt-2');
    });

    it('should return scenario unchanged when no termination events', async () => {
      const scenarioResult = { id: 1, title: 'Test', terminationEvents: [] };
      scenariosRepository.getAdminScenarioById.mockResolvedValue(
        scenarioResult as any,
      );
      sharedLanguageService.getLanguageByValue.mockResolvedValue(null);

      const result = await service.getAdminScenario(1);

      expect(result).toEqual({
        ...scenarioResult,
        translationOpeningStatements: {},
        openingDialoguePrimaryLanguageId: null,
        translationDescription: {},
        challengeDescriptionPrimaryLanguageId: null,
        translationTitle: {},
      });
      expect(
        sessionEventSharedService.findSessionEventById,
      ).not.toHaveBeenCalled();
    });

    it('should map translationOpeningStatements when stored as newline-separated string (session/admin parity)', async () => {
      const scenarioResult = {
        id: 1,
        title: 'Test',
        terminationEvents: [],
      };
      scenariosRepository.getAdminScenarioById.mockResolvedValue(
        scenarioResult as any,
      );
      scenarioTranslationsRepository.getScenarioTranslationsByScenarioId.mockResolvedValue(
        [
          {
            scenarioId: 1,
            languageId: 7,
            metadata: { openingStatements: 'Hola\n¿Qué tal?' },
          },
        ] as any,
      );
      sharedLanguageService.getLanguageByValue.mockResolvedValue({
        id: 1,
      } as any);

      const result = await service.getAdminScenario(1);

      expect(result.translationOpeningStatements).toEqual({
        '7': ['Hola', '¿Qué tal?'],
      });
    });

    it('should map translationDescription from scenario_translations.metadata.description', async () => {
      const scenarioResult = {
        id: 1,
        title: 'Test',
        terminationEvents: [],
      };
      scenariosRepository.getAdminScenarioById.mockResolvedValue(
        scenarioResult as any,
      );
      scenarioTranslationsRepository.getScenarioTranslationsByScenarioId.mockResolvedValue(
        [
          {
            scenarioId: 1,
            languageId: 7,
            metadata: { description: 'Descripción en español' },
          },
          {
            scenarioId: 1,
            languageId: 9,
            metadata: { description: '   ' },
          },
        ] as any,
      );
      sharedLanguageService.getLanguageByValue.mockResolvedValue({
        id: 1,
      } as any);

      const result = await service.getAdminScenario(1);

      expect(result.translationDescription).toEqual({
        '7': 'Descripción en español',
      });
      expect(result.challengeDescriptionPrimaryLanguageId).toBe(1);
    });

    it('should map translationTitle from scenario_translations.metadata.title and skip empty values', async () => {
      const scenarioResult = {
        id: 1,
        title: 'Test',
        terminationEvents: [],
      };
      scenariosRepository.getAdminScenarioById.mockResolvedValue(
        scenarioResult as any,
      );
      scenarioTranslationsRepository.getScenarioTranslationsByScenarioId.mockResolvedValue(
        [
          {
            scenarioId: 1,
            languageId: 7,
            metadata: { title: 'Título en español' },
          },
          {
            scenarioId: 1,
            languageId: 9,
            metadata: { title: '   ' },
          },
        ] as any,
      );
      sharedLanguageService.getLanguageByValue.mockResolvedValue({
        id: 1,
      } as any);

      const result = await service.getAdminScenario(1);

      expect(result.translationTitle).toEqual({
        '7': 'Título en español',
      });
    });

    it('should map translationReminders from scenario_translations.metadata.reminders and skip empty rows', async () => {
      const scenarioResult = {
        id: 1,
        title: 'Test',
        terminationEvents: [],
      };
      scenariosRepository.getAdminScenarioById.mockResolvedValue(
        scenarioResult as any,
      );
      scenarioTranslationsRepository.getScenarioTranslationsByScenarioId.mockResolvedValue(
        [
          {
            scenarioId: 1,
            languageId: 7,
            metadata: { reminders: ['Mantén el contacto visual', '  '] },
          },
          {
            scenarioId: 1,
            languageId: 9,
            metadata: { reminders: [] },
          },
        ] as any,
      );
      sharedLanguageService.getLanguageByValue.mockResolvedValue({
        id: 1,
      } as any);

      const result = await service.getAdminScenario(1);

      expect(result.translationReminders).toEqual({
        '7': ['Mantén el contacto visual'],
      });
      expect(result.remindersPrimaryLanguageId).toBe(1);
    });

    it('should expose both translationDescription and translationOpeningStatements from same row when both metadata fields are present', async () => {
      const scenarioResult = {
        id: 1,
        title: 'Test',
        terminationEvents: [],
      };
      scenariosRepository.getAdminScenarioById.mockResolvedValue(
        scenarioResult as any,
      );
      scenarioTranslationsRepository.getScenarioTranslationsByScenarioId.mockResolvedValue(
        [
          {
            scenarioId: 1,
            languageId: 7,
            metadata: {
              openingStatements: ['Hola'],
              description: 'Descripción en español',
            },
          },
        ] as any,
      );
      sharedLanguageService.getLanguageByValue.mockResolvedValue({
        id: 1,
      } as any);

      const result = await service.getAdminScenario(1);

      expect(result.translationOpeningStatements).toEqual({ '7': ['Hola'] });
      expect(result.translationDescription).toEqual({
        '7': 'Descripción en español',
      });
    });
  });

  describe('getPreviousScenarioSessionByCaseSessionItemId', () => {
    it('should find session by caseSessionItemId with non-null score ordered by score DESC', async () => {
      const previousSession = {
        id: 'prev-session',
        caseSessionItemId: 'case-item-1',
        score: 85,
      } as any;
      scenarioSessionRepository.findOne.mockResolvedValue(previousSession);

      const result =
        await service.getPreviousScenarioSessionByCaseSessionItemId(
          'case-item-1',
        );

      expect(result).toEqual(previousSession);
      expect(scenarioSessionRepository.findOne).toHaveBeenCalledWith({
        where: {
          caseSessionItemId: 'case-item-1',
          score: Not(IsNull()),
        },
        order: { score: 'DESC' },
      });
    });
  });

  describe('createMetadataForScenario', () => {
    it('should use getSessionEventsByScenarioId when language is English (languageId equals en id)', async () => {
      const scenarioId = 1;
      const languageId = 1;
      const enDetails = { id: 1, value: 'en' };
      const scenario = {
        id: scenarioId,
        title: 'Test',
        metadata: {},
        terminationEvents: [],
      } as any;
      const sessionEvents = [{ id: 'e1', name: 'Event 1' }] as any;
      const roomMetadata = { version: '1.0', scenario: {} };

      scenariosRepository.getAdminScenarioById.mockResolvedValue(scenario);
      sharedLanguageService.getLanguageByValue.mockResolvedValue(
        enDetails as any,
      );
      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        enDetails,
      ] as any);
      sessionEventSharedService.getSessionEventsByScenarioId.mockResolvedValue(
        sessionEvents,
      );
      jest
        .spyOn(service, 'createRoomMetadata' as any)
        .mockResolvedValue(roomMetadata);

      await service.createMetadataForScenario(scenarioId, languageId);

      expect(
        sessionEventSharedService.getSessionEventsByScenarioId,
      ).toHaveBeenCalledWith(scenarioId);
      expect(
        sessionEventSharedService.getSessionEventsTranslationsByScenarioId,
      ).not.toHaveBeenCalled();
    });

    it('should use getSessionEventsTranslationsByScenarioId when language is not English', async () => {
      const scenarioId = 1;
      const languageId = 2;
      const enDetails = { id: 1, value: 'en' };
      const esDetails = { id: 2, value: 'es-ES' };
      const scenario = {
        id: scenarioId,
        title: 'Test',
        metadata: {},
        terminationEvents: [],
      } as any;
      const translatedEvents = [{ id: 'e1', name: 'Evento 1' }] as any;
      const roomMetadata = { version: '1.0', scenario: {} };

      scenariosRepository.getAdminScenarioById.mockResolvedValue(scenario);
      sharedLanguageService.getLanguageByValue.mockResolvedValue(
        enDetails as any,
      );
      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        esDetails,
      ] as any);
      sessionEventSharedService.getSessionEventsTranslationsByScenarioId.mockResolvedValue(
        translatedEvents,
      );
      jest
        .spyOn(service, 'createRoomMetadata' as any)
        .mockResolvedValue(roomMetadata);

      await service.createMetadataForScenario(scenarioId, languageId);

      expect(
        sessionEventSharedService.getSessionEventsTranslationsByScenarioId,
      ).toHaveBeenCalledWith(scenarioId, languageId);
      expect(
        sessionEventSharedService.getSessionEventsByScenarioId,
      ).not.toHaveBeenCalled();
    });

    it('should replace termination events with translated versions and set autoTerminationStatus when non-English', async () => {
      const scenarioId = 1;
      const languageId = 2;
      const enDetails = { id: 1, value: 'en' };
      const esDetails = { id: 2, value: 'es-ES' };
      const scenario = {
        id: scenarioId,
        title: 'Test',
        metadata: {},
        terminationEvents: [{ eventId: 'term-1', message: 'Original end' }],
      } as any;
      const translatedEvents = [
        {
          id: 'term-1',
          name: 'Translated Term',
          message: 'Mensaje final',
        },
      ] as any;
      const roomMetadata = { version: '1.0', scenario: {} };

      scenariosRepository.getAdminScenarioById.mockResolvedValue({
        ...scenario,
      });
      sharedLanguageService.getLanguageByValue.mockResolvedValue(
        enDetails as any,
      );
      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        esDetails,
      ] as any);
      sessionEventSharedService.getSessionEventsTranslationsByScenarioId.mockResolvedValue(
        translatedEvents,
      );
      let capturedScenario: any;
      jest
        .spyOn(service, 'createRoomMetadata' as any)
        .mockImplementation((opts: any) => {
          capturedScenario = opts.scenario;
          return Promise.resolve(roomMetadata);
        });

      await service.createMetadataForScenario(scenarioId, languageId);

      expect(capturedScenario.terminationEvents).toHaveLength(1);
      expect(capturedScenario.terminationEvents[0]).toMatchObject({
        eventId: 'term-1',
        name: 'Translated Term',
        message: 'Mensaje final',
        autoTerminationStatus: true,
      });
    });

    it('should set metadata.language, languageId and defaultLanguageId on scenario before createRoomMetadata', async () => {
      const scenarioId = 1;
      const languageId = 2;
      const enDetails = { id: 1, value: 'en' };
      const esDetails = { id: 2, value: 'es-ES' };
      const scenario = {
        id: scenarioId,
        title: 'Test',
        metadata: {},
        terminationEvents: [],
      } as any;
      sessionEventSharedService.getSessionEventsTranslationsByScenarioId.mockResolvedValue(
        [],
      );
      scenariosRepository.getAdminScenarioById.mockResolvedValue(scenario);
      sharedLanguageService.getLanguageByValue.mockResolvedValue(
        enDetails as any,
      );
      sharedLanguageService.getLanguagesByIds.mockResolvedValue([
        esDetails,
      ] as any);
      let capturedScenario: any;
      jest
        .spyOn(service, 'createRoomMetadata' as any)
        .mockImplementation((opts: any) => {
          capturedScenario = opts.scenario;
          return Promise.resolve({});
        });

      await service.createMetadataForScenario(scenarioId, languageId);

      expect(capturedScenario.metadata.language).toBe('es-ES');
      expect(capturedScenario.metadata.languageId).toBe(2);
      expect(capturedScenario.metadata.defaultLanguageId).toBe(1);
    });
  });

  describe('getBehaviorInstructionsByScenarioId', () => {
    it('should return undefined when no instructions exist for scenario', async () => {
      scenarioBehaviorInstructionRepository.getByScenarioId.mockResolvedValue(
        [],
      );

      const result = await service.getBehaviorInstructionsByScenarioId(1);

      expect(result).toBeUndefined();
      expect(
        scenarioBehaviorInstructionBehaviorRepository.getByInstructionIds,
      ).not.toHaveBeenCalled();
      expect(behaviorRepository.getBehaviorsByIds).not.toHaveBeenCalled();
    });

    it('should return formatted behavior instructions with behaviors when instructions exist', async () => {
      const instructions = [
        {
          id: 'inst-1',
          scenarioId: 1,
          category: 'SHOULD_DO',
          stateInstructions: [{ stateId: '1', instruction: 'Listen actively' }],
        },
      ] as any;
      const behaviorMappings = [
        {
          scenarioBehaviorInstructionId: 'inst-1',
          behaviorId: 'beh-1',
        },
      ] as any;
      const behaviors = [{ id: 'beh-1', name: 'Reflection' }] as any;

      scenarioBehaviorInstructionRepository.getByScenarioId.mockResolvedValue(
        instructions,
      );
      scenarioBehaviorInstructionBehaviorRepository.getByInstructionIds.mockResolvedValue(
        behaviorMappings,
      );
      behaviorRepository.getBehaviorsByIds.mockResolvedValue(behaviors);

      const result = await service.getBehaviorInstructionsByScenarioId(1);

      expect(result).toHaveLength(1);
      expect(result![0]).toMatchObject({
        id: 'inst-1',
        category: 'SHOULD_DO',
        stateInstructions: [{ stateId: '1', instruction: 'Listen actively' }],
        behaviors: [{ id: 'beh-1', name: 'Reflection' }],
      });
      expect(
        scenarioBehaviorInstructionRepository.getByScenarioId,
      ).toHaveBeenCalledWith(1);
      expect(
        scenarioBehaviorInstructionBehaviorRepository.getByInstructionIds,
      ).toHaveBeenCalledWith(['inst-1']);
      expect(behaviorRepository.getBehaviorsByIds).toHaveBeenCalledWith([
        'beh-1',
      ]);
    });
  });

  describe('createRoomMetadata', () => {
    it('should forward scenario.prompt as promptData.roleInstructions', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);

      const result = await service.createRoomMetadata({
        scenario: {
          id: 1,
          title: 'Test Scenario',
          description: 'Test Description',
          prompt: 'Act only as the client in this simulation.',
          metadata: {
            voiceId: 'voice-1',
            name: 'Alex',
            age: 28,
            gender: 'Male',
            currentLocation: 'NYC',
            openingStatements: ['Hi'],
          },
          terminationEvents: [],
          behaviorInstructions: [],
          difficultyLevel: 'EASY',
        } as any,
        sessionEvents: [],
        languageDetails: null as any,
        previousMemory: null,
      });

      expect(result.scenario.promptData.roleInstructions).toBe(
        'Act only as the client in this simulation.',
      );
    });

    it('should put languageDetails.label on promptData.languageLabel so the LLM gets a human-readable language name', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);
      // Non-English language triggers a translation lookup; return null so
      // createRoomMetadata short-circuits past it.
      (scenarioTranslationsRepository as any).findOne = jest
        .fn()
        .mockResolvedValue(null);

      const result = await service.createRoomMetadata({
        scenario: {
          id: 1,
          title: 'Test Scenario',
          description: 'Test Description',
          prompt: 'Act only as the client.',
          metadata: {
            voiceId: 'voice-1',
            languageId: 2,
            language: 'ta-IN',
            name: 'Alex',
            age: 28,
            gender: 'Male',
            currentLocation: 'Chennai',
            openingStatements: ['Vanakkam'],
          },
          terminationEvents: [],
          behaviorInstructions: [],
          difficultyLevel: 'EASY',
        } as any,
        sessionEvents: [],
        languageDetails: {
          id: 2,
          value: 'ta-IN',
          label: 'Tamil (India)',
        } as any,
        previousMemory: null,
      });

      expect((result.scenario.promptData as any).languageLabel).toBe(
        'Tamil (India)',
      );
    });

    it('should leave promptData.languageLabel undefined when languageDetails has no label', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);

      const result = await service.createRoomMetadata({
        scenario: {
          id: 1,
          title: 'Test Scenario',
          description: 'Test Description',
          prompt: 'Act only as the client.',
          metadata: {
            voiceId: 'voice-1',
            name: 'Alex',
            age: 28,
            gender: 'Male',
            currentLocation: 'NYC',
            openingStatements: ['Hi'],
          },
          terminationEvents: [],
          behaviorInstructions: [],
          difficultyLevel: 'EASY',
        } as any,
        sessionEvents: [],
        languageDetails: null as any,
        previousMemory: null,
      });

      expect((result.scenario.promptData as any).languageLabel).toBeUndefined();
    });

    const glossaryScenario = {
      id: 1,
      title: 'Test Scenario',
      description: 'Test Description',
      prompt: 'Act only as the client.',
      metadata: {
        voiceId: 'voice-1',
        languageId: 2,
        language: 'ta-IN',
        name: 'Alex',
        age: 28,
        gender: 'Male',
        currentLocation: 'Chennai',
        openingStatements: ['Vanakkam'],
        // The temporary per-sim canary gate — glossary tests opt in.
        languageGlossaryEnabled: true,
      },
      terminationEvents: [],
      behaviorInstructions: [],
      difficultyLevel: 'EASY',
    } as any;

    it('should put the compiled Tier 0 glossary on promptData.languageGlossary for non-English sessions', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);
      (scenarioTranslationsRepository as any).findOne = jest
        .fn()
        .mockResolvedValue(null);
      const glossaryService = (service as any).languageGlossaryService;
      glossaryService.resolveTier0Glossary = jest
        .fn()
        .mockResolvedValue('## Core style\n- worry: say "டென்ஷன்"');

      const result = await service.createRoomMetadata({
        scenario: glossaryScenario,
        sessionEvents: [],
        languageDetails: {
          id: 2,
          value: 'ta-IN',
          label: 'Tamil (India)',
        } as any,
        previousMemory: null,
      });

      expect(glossaryService.resolveTier0Glossary).toHaveBeenCalledWith(2);
      expect((result.scenario.promptData as any).languageGlossary).toContain(
        '## Core style',
      );
    });

    it('should skip the glossary entirely when the simulation has not opted in (default OFF)', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);
      (scenarioTranslationsRepository as any).findOne = jest
        .fn()
        .mockResolvedValue(null);
      const glossaryService = (service as any).languageGlossaryService;
      glossaryService.resolveTier0Glossary = jest.fn();
      glossaryService.resolveTier1Sections = jest.fn();
      glossaryService.resolveGlossaryMeta = jest.fn();

      const metadataWithoutToggle = { ...glossaryScenario.metadata };
      delete (metadataWithoutToggle as any).languageGlossaryEnabled;
      const result = await service.createRoomMetadata({
        scenario: { ...glossaryScenario, metadata: metadataWithoutToggle },
        sessionEvents: [],
        languageDetails: {
          id: 2,
          value: 'ta-IN',
          label: 'Tamil (India)',
        } as any,
        previousMemory: null,
      });

      expect(glossaryService.resolveTier0Glossary).not.toHaveBeenCalled();
      expect(glossaryService.resolveTier1Sections).not.toHaveBeenCalled();
      expect(glossaryService.resolveGlossaryMeta).not.toHaveBeenCalled();
      const promptData = result.scenario.promptData as any;
      expect(promptData.languageGlossary).toBeUndefined();
      expect(promptData.glossarySections).toBeUndefined();
      expect(promptData.glossaryMeta).toBeUndefined();
      // The gate itself must not leak to the agent payload either.
      expect(promptData.languageGlossaryEnabled).toBeUndefined();
    });

    it('should skip the glossary entirely for English sessions', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);
      (scenarioTranslationsRepository as any).findOne = jest
        .fn()
        .mockResolvedValue(null);
      const glossaryService = (service as any).languageGlossaryService;
      glossaryService.resolveTier0Glossary = jest.fn();

      const result = await service.createRoomMetadata({
        scenario: glossaryScenario,
        sessionEvents: [],
        languageDetails: {
          id: 1,
          value: 'en-IN',
          label: 'English (India)',
        } as any,
        previousMemory: null,
      });

      expect(glossaryService.resolveTier0Glossary).not.toHaveBeenCalled();
      expect(
        (result.scenario.promptData as any).languageGlossary,
      ).toBeUndefined();
    });

    it('should never block a session when glossary resolution fails', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);
      (scenarioTranslationsRepository as any).findOne = jest
        .fn()
        .mockResolvedValue(null);
      const glossaryService = (service as any).languageGlossaryService;
      glossaryService.resolveTier0Glossary = jest
        .fn()
        .mockRejectedValue(new Error('db down'));

      const result = await service.createRoomMetadata({
        scenario: glossaryScenario,
        sessionEvents: [],
        languageDetails: {
          id: 2,
          value: 'ta-IN',
          label: 'Tamil (India)',
        } as any,
        previousMemory: null,
      });

      expect(
        (result.scenario.promptData as any).languageGlossary,
      ).toBeUndefined();
      expect((result.scenario.promptData as any).languageLabel).toBe(
        'Tamil (India)',
      );
    });

    it('should ship prefixed Tier 1 glossary sections on promptData.glossarySections', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);
      (scenarioTranslationsRepository as any).findOne = jest
        .fn()
        .mockResolvedValue(null);
      const glossaryService = (service as any).languageGlossaryService;
      glossaryService.resolveTier0Glossary = jest.fn().mockResolvedValue('');
      glossaryService.resolveTier1Sections = jest.fn().mockResolvedValue([
        {
          title: 'Clinical terms',
          content: '## Clinical terms\n- worry: say "டென்ஷன்"',
          retrievalHint: 'Retrieve when clinical.',
        },
      ]);

      const result = await service.createRoomMetadata({
        scenario: glossaryScenario,
        sessionEvents: [],
        languageDetails: {
          id: 2,
          value: 'ta-IN',
          label: 'Tamil (India)',
        } as any,
        previousMemory: null,
      });

      const sections = (result.scenario.promptData as any).glossarySections;
      expect(sections).toHaveLength(1);
      expect(sections[0].title).toBe('[Tamil (India) glossary] Clinical terms');
      expect(sections[0].retrievalHint).toBe('Retrieve when clinical.');
    });

    it('should omit glossarySections when no retrieved sections are published', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);
      (scenarioTranslationsRepository as any).findOne = jest
        .fn()
        .mockResolvedValue(null);
      const glossaryService = (service as any).languageGlossaryService;
      glossaryService.resolveTier0Glossary = jest.fn().mockResolvedValue('');
      glossaryService.resolveTier1Sections = jest.fn().mockResolvedValue([]);

      const result = await service.createRoomMetadata({
        scenario: glossaryScenario,
        sessionEvents: [],
        languageDetails: {
          id: 2,
          value: 'ta-IN',
          label: 'Tamil (India)',
        } as any,
        previousMemory: null,
      });

      expect(
        (result.scenario.promptData as any).glossarySections,
      ).toBeUndefined();
    });

    it('should stamp glossary provenance on promptData.glossaryMeta for non-English sessions', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);
      (scenarioTranslationsRepository as any).findOne = jest
        .fn()
        .mockResolvedValue(null);
      const glossaryService = (service as any).languageGlossaryService;
      glossaryService.resolveTier0Glossary = jest.fn().mockResolvedValue('');
      glossaryService.resolveTier1Sections = jest.fn().mockResolvedValue([]);
      glossaryService.resolveGlossaryMeta = jest.fn().mockResolvedValue({
        versions: { core_style: 4, clinical_terms: 2 },
        tier0Tokens: 381,
      });

      const result = await service.createRoomMetadata({
        scenario: glossaryScenario,
        sessionEvents: [],
        languageDetails: {
          id: 2,
          value: 'ta-IN',
          label: 'Tamil (India)',
        } as any,
        previousMemory: null,
      });

      expect(glossaryService.resolveGlossaryMeta).toHaveBeenCalledWith(2);
      expect((result.scenario.promptData as any).glossaryMeta).toEqual({
        versions: { core_style: 4, clinical_terms: 2 },
        tier0Tokens: 381,
      });
    });

    it('should omit glossaryMeta (and never block the session) when meta resolution fails or is empty', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);
      (scenarioTranslationsRepository as any).findOne = jest
        .fn()
        .mockResolvedValue(null);
      const glossaryService = (service as any).languageGlossaryService;
      glossaryService.resolveTier0Glossary = jest.fn().mockResolvedValue('');
      glossaryService.resolveTier1Sections = jest.fn().mockResolvedValue([]);
      glossaryService.resolveGlossaryMeta = jest
        .fn()
        .mockRejectedValue(new Error('db down'));

      const result = await service.createRoomMetadata({
        scenario: glossaryScenario,
        sessionEvents: [],
        languageDetails: {
          id: 2,
          value: 'ta-IN',
          label: 'Tamil (India)',
        } as any,
        previousMemory: null,
      });

      expect((result.scenario.promptData as any).glossaryMeta).toBeUndefined();

      // Null meta (nothing published) also leaves the field absent.
      glossaryService.resolveGlossaryMeta = jest.fn().mockResolvedValue(null);
      const result2 = await service.createRoomMetadata({
        scenario: glossaryScenario,
        sessionEvents: [],
        languageDetails: {
          id: 2,
          value: 'ta-IN',
          label: 'Tamil (India)',
        } as any,
        previousMemory: null,
      });
      expect((result2.scenario.promptData as any).glossaryMeta).toBeUndefined();
    });

    it('should put active language characteristics on promptData.languageCharacteristics (trimmed string)', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);

      const result = await service.createRoomMetadata({
        scenario: {
          id: 1,
          title: 'Test Scenario',
          description: 'Test Description',
          prompt: 'Act only as the client.',
          metadata: {
            voiceId: 'voice-1',
            languageId: 1,
            language: 'en',
            name: 'Alex',
            age: 28,
            gender: 'Male',
            currentLocation: 'NYC',
            openingStatements: ['Hi'],
            languageCharacteristics: {
              '1': '  Speaks Chennai-style Tamil with English code-mixing.  ',
              '2': 'Different scenario, different language.',
            },
          },
          terminationEvents: [],
          behaviorInstructions: [],
          difficultyLevel: 'EASY',
        } as any,
        sessionEvents: [],
        languageDetails: null as any,
        previousMemory: null,
      });

      expect((result.scenario.promptData as any).languageCharacteristics).toBe(
        'Speaks Chennai-style Tamil with English code-mixing.',
      );
    });

    it('should leave languageCharacteristics unset when blank or missing for active language', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);

      const result = await service.createRoomMetadata({
        scenario: {
          id: 1,
          title: 'Test Scenario',
          description: 'Test Description',
          prompt: 'Act only as the client.',
          metadata: {
            voiceId: 'voice-1',
            languageId: 1,
            language: 'en',
            name: 'Alex',
            age: 28,
            gender: 'Male',
            currentLocation: 'NYC',
            openingStatements: ['Hi'],
            languageCharacteristics: { '1': '   ' },
          },
          terminationEvents: [],
          behaviorInstructions: [],
          difficultyLevel: 'EASY',
        } as any,
        sessionEvents: [],
        languageDetails: null as any,
        previousMemory: null,
      });

      expect(
        (result.scenario.promptData as any).languageCharacteristics,
      ).toBeUndefined();
    });

    it('should put active language allowed fillers on promptData.allowedFillerWords (string[])', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);

      const result = await service.createRoomMetadata({
        scenario: {
          id: 1,
          title: 'Test Scenario',
          description: 'Test Description',
          prompt: 'Act only as the client.',
          metadata: {
            voiceId: 'voice-1',
            languageId: 1,
            language: 'en',
            name: 'Alex',
            age: 28,
            gender: 'Male',
            currentLocation: 'NYC',
            openingStatements: ['Hi'],
            allowedFillerWords: { '1': ['  um  ', 'like'] },
          },
          terminationEvents: [],
          behaviorInstructions: [],
          difficultyLevel: 'EASY',
        } as any,
        sessionEvents: [],
        languageDetails: null as any,
        previousMemory: null,
      });

      expect(result.scenario.promptData.allowedFillerWords).toEqual([
        'um',
        'like',
      ]);
      expect(
        (result.scenario.promptData as any).allowedFillers,
      ).toBeUndefined();
    });

    it('should include the current environment in room metadata', async () => {
      scenarioVoiceRepository.findOne.mockResolvedValue({
        id: 'voice-1',
        name: 'Test Voice',
        provider: 'deepgram',
        config: {},
      } as any);

      const result = await service.createRoomMetadata({
        scenario: {
          id: 1,
          title: 'Test Scenario',
          description: 'Test Description',
          prompt: 'Act only as the client.',
          metadata: {
            voiceId: 'voice-1',
            name: 'Alex',
            age: 28,
            gender: 'Male',
            currentLocation: 'NYC',
            openingStatements: ['Hi'],
          },
          terminationEvents: [],
          behaviorInstructions: [],
          difficultyLevel: 'EASY',
        } as any,
        sessionEvents: [],
        languageDetails: null as any,
        previousMemory: null,
      });

      expect(result.environment).toBe('development');
    });

    describe('deprecated event types excluded from metadata', () => {
      const baseScenario = {
        id: 1,
        title: 'Test Scenario',
        description: 'Test Description',
        prompt: 'Act only as the client.',
        metadata: {
          voiceId: 'voice-1',
          name: 'Alex',
          age: 28,
          gender: 'Male',
          currentLocation: 'NYC',
          openingStatements: ['Hi'],
        },
        behaviorInstructions: [],
        difficultyLevel: 'EASY',
      } as any;

      beforeEach(() => {
        scenarioVoiceRepository.findOne.mockResolvedValue({
          id: 'voice-1',
          name: 'Test Voice',
          provider: 'deepgram',
          config: {},
        } as any);
      });

      it('excludes a directly-attached SENTENCE_SIMILARITY event from scenario.events', async () => {
        const result = await service.createRoomMetadata({
          scenario: { ...baseScenario, terminationEvents: [] },
          sessionEvents: [
            {
              id: 'S1',
              detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
              detectionData: { sentences: ['hello'] },
            } as any,
            {
              id: 'SC1',
              detectionType: SessionEventDetectionType.SCORE,
              detectionData: { score: 5 },
            } as any,
          ],
          languageDetails: null as any,
          previousMemory: null,
        });

        const eventIds = result.scenario.events.map((e: any) => e.id);
        expect(eventIds).not.toContain('S1');
        expect(eventIds).toContain('SC1');
        expect(result.scenario.triggerEvents).not.toContain('S1');
      });

      it('excludes a SEMANTIC_SIMILARITY event fetched only as a COMBINATION dependency, and degrades the combination gracefully', async () => {
        sessionEventSharedService.findByIds.mockResolvedValue([
          {
            id: 'SM1',
            detectionType: SessionEventDetectionType.SEMANTIC_SIMILARITY,
            detectionData: { sentences: ['hello'] },
          } as any,
        ]);

        const result = await service.createRoomMetadata({
          scenario: { ...baseScenario, terminationEvents: [] },
          sessionEvents: [
            {
              id: 'C1',
              detectionType: SessionEventDetectionType.COMBINATION,
              detectionData: {
                expression: { type: 'IDENTIFIER', id: 'SM1' },
              },
            } as any,
          ],
          languageDetails: null as any,
          previousMemory: null,
        });

        const eventIds = result.scenario.events.map((e: any) => e.id);
        expect(eventIds).not.toContain('SM1');
        // The combination event itself is still sent — it just resolves its
        // SM1 dependency as absent (ai-learn's event_registry.get() -> None
        // -> happened=False), the same graceful degradation already proven
        // for any other missing/unknown dependency.
        expect(eventIds).toContain('C1');
      });

      it('drops an autoTerminationEvent whose target is a deprecated-type event', async () => {
        sessionEventSharedService.findByIds.mockResolvedValue([
          {
            id: 'S1',
            detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
            detectionData: { sentences: ['stop now'] },
          } as any,
        ]);

        const result = await service.createRoomMetadata({
          scenario: {
            ...baseScenario,
            terminationEvents: [{ eventId: 'S1', message: 'Session ended' }],
          },
          sessionEvents: [],
          languageDetails: null as any,
          previousMemory: null,
        });

        expect(result.scenario.autoTerminationEvents).toEqual([]);
        expect(result.scenario.events.map((e: any) => e.id)).not.toContain(
          'S1',
        );
      });

      it('keeps an autoTerminationEvent whose target is NOT a deprecated-type event', async () => {
        sessionEventSharedService.findByIds.mockResolvedValue([
          {
            id: 'SC1',
            detectionType: SessionEventDetectionType.SCORE,
            detectionData: { score: 100 },
          } as any,
        ]);

        const result = await service.createRoomMetadata({
          scenario: {
            ...baseScenario,
            terminationEvents: [{ eventId: 'SC1', message: 'Session ended' }],
          },
          sessionEvents: [],
          languageDetails: null as any,
          previousMemory: null,
        });

        expect(result.scenario.autoTerminationEvents).toEqual([
          { id: 'SC1', terminationMessage: 'Session ended' },
        ]);
      });
    });
  });

  describe('getBehaviorsByIds', () => {
    it('should return behaviors from repository', async () => {
      const ids = ['beh-1', 'beh-2'];
      const behaviors = [
        { id: 'beh-1', name: 'Behavior 1' },
        { id: 'beh-2', name: 'Behavior 2' },
      ] as any;
      behaviorRepository.getBehaviorsByIds.mockResolvedValue(behaviors);

      const result = await service.getBehaviorsByIds(ids);

      expect(result).toEqual(behaviors);
      expect(behaviorRepository.getBehaviorsByIds).toHaveBeenCalledWith(ids);
    });
  });

  describe('getPromptsForScenarioSession', () => {
    it('should return an empty object when no prompts are found', async () => {
      promptSharedService.getPromptsByOptions.mockResolvedValue([]);

      const result = await (service as any).getPromptsForScenarioSession();

      expect(promptSharedService.getPromptsByOptions).toHaveBeenCalledWith({
        promptCodePrefix: ALLY_AI_LEARN_PROMPT_PREFIX,
        useDashboardOverrideOnly: true,
      });
      expect(result).toEqual({});
    });

    it('should return a map of promptCode -> prompt when prompts are found', async () => {
      const mockPrompts = [
        {
          promptCode: 'ally_ai_learn_system_default_system_prompt',
          prompt: 'Default prompt text',
          availableVariables: [],
        },
        {
          promptCode: 'ally_ai_learn_system_audio_tag_guidance',
          prompt: 'Audio tag guidance text',
          availableVariables: [],
        },
        {
          promptCode: 'ally_ai_learn_counselor_report_generation_prompt',
          prompt: 'Report generation text',
          availableVariables: [],
        },
      ];
      promptSharedService.getPromptsByOptions.mockResolvedValue(mockPrompts);

      const result = await (service as any).getPromptsForScenarioSession();

      expect(promptSharedService.getPromptsByOptions).toHaveBeenCalledWith({
        promptCodePrefix: ALLY_AI_LEARN_PROMPT_PREFIX,
        useDashboardOverrideOnly: true,
      });
      expect(result).toEqual({
        ally_ai_learn_system_default_system_prompt: {
          prompt: 'Default prompt text',
          availableVariables: [],
          hasStates: false,
        },
        ally_ai_learn_system_audio_tag_guidance: {
          prompt: 'Audio tag guidance text',
          availableVariables: [],
          hasStates: false,
        },
        ally_ai_learn_counselor_report_generation_prompt: {
          prompt: 'Report generation text',
          availableVariables: [],
          hasStates: false,
        },
      });
    });

    it('should correctly overwrite duplicate promptCodes with the last value', async () => {
      const mockPrompts = [
        {
          promptCode: 'ally_ai_learn_system_default_system_prompt',
          prompt: 'First value',
        },
        {
          promptCode: 'ally_ai_learn_system_default_system_prompt',
          prompt: 'Second value',
        },
      ];
      promptSharedService.getPromptsByOptions.mockResolvedValue(mockPrompts);

      const result = await (service as any).getPromptsForScenarioSession();

      expect(result).toEqual({
        ally_ai_learn_system_default_system_prompt: {
          prompt: 'Second value',
          availableVariables: [],
          hasStates: false,
        },
      });
    });
  });

  describe('saveScenarioSessionRecording', () => {
    it('should create and save a scenario session recording', async () => {
      const scenarioSessionId = 'session-123';
      const storageKey = 'recordings/2025/01/01/test-room.ogg';
      const tenantId = 'tenant-1';
      const egressId = 'egress-abc';

      scenarioSessionRecordingRepository.create.mockImplementation(
        (data) => data as ScenarioSessionRecording,
      );
      const persisted: ScenarioSessionRecording = {
        id: 'rec-1',
        scenarioSessionId,
        storageKey,
        egressId,
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      scenarioSessionRecordingRepository.save.mockResolvedValue(persisted);

      const result = await service.saveScenarioSessionRecording({
        scenarioSessionId,
        storageKey,
        tenantId,
        egressId,
      });

      expect(scenarioSessionRecordingRepository.create).toHaveBeenCalledWith({
        scenarioSessionId,
        storageKey,
        tenantId,
        egressId,
      });
      expect(scenarioSessionRecordingRepository.save).toHaveBeenCalledWith({
        scenarioSessionId,
        storageKey,
        tenantId,
        egressId,
      });
      expect(result).toMatchObject({
        id: 'rec-1',
        scenarioSessionId,
        storageKey,
        egressId,
        tenantId,
      });
    });
  });

  describe('getScenarioSessionSkills', () => {
    const scenarioSessionId = 'session-uuid-123';

    it('should return skillCoverage and emotionalMovement when details exist with full feedback', async () => {
      const skillCoverage = [
        { category: 'Learning', percentage: 75 },
        { category: 'Support', percentage: 80 },
      ];
      const emotionalMovement = [
        { message_id: '1', level: 3, start_time: 0 },
        { message_id: '2', level: 4, start_time: 5.2 },
      ];
      scenarioSessionDetailsRepository.findOne.mockResolvedValue({
        scenarioSessionId,
        summary: {
          feedback: {
            skillCoverage,
            emotionalMovement,
          },
        },
      } as any);

      const result = await service.getScenarioSessionSkills(scenarioSessionId);

      expect(scenarioSessionDetailsRepository.findOne).toHaveBeenCalledWith({
        where: { scenarioSessionId },
      });
      expect(result.skillCoverage).toEqual([
        {
          category: 'Learning',
          percentage: 75,
          iconUrl:
            'https://test-assets-bucket.s3.us-east-1.amazonaws.com/skill-icons/Learning.svg',
        },
        {
          category: 'Support',
          percentage: 80,
          iconUrl:
            'https://test-assets-bucket.s3.us-east-1.amazonaws.com/skill-icons/Support.svg',
        },
      ]);
      expect(result.emotionalMovement).toEqual([
        { messageId: '1', level: 3, startTime: 0 },
        { messageId: '2', level: 4, startTime: 5.2 },
      ]);
    });
  });

  describe('hasAllActiveScenarioMandatoryFields', () => {
    const baseScenario = {
      scenario_title: 'Test',
      scenario_prompt: 'You are a test client.',
      scenario_description: 'Desc',
      scenario_coverImageUrl: 'https://img.png',
      scenario_difficultyLevel: 'medium',
      scenario_metadata: {
        name: 'Jane',
        age: 30,
        gender: 'Female',
        currentLocation: 'NY',
        openingStatements: ['Hello'],
        experienceMode: 'CONVERSATION',
        competencyId: 1,
        stateNames: ['state1'],
        languageVoices: { '1': 'voice-1' },
      },
    };

    it('returns true when all required fields are present', () => {
      expect(service.hasAllActiveScenarioMandatoryFields(baseScenario)).toBe(
        true,
      );
    });

    it('returns true when optional fields (characterProfileText, behaviorInstructions, linguisticStyleSamples) are absent', () => {
      const scenario = { ...baseScenario };
      expect(service.hasAllActiveScenarioMandatoryFields(scenario)).toBe(true);
    });

    it('returns false when prompt is empty string', () => {
      // prompt (role instructions) is a mandatory field, so a blank prompt
      // must block activation.
      const scenario = {
        ...baseScenario,
        scenario_prompt: '',
      };
      expect(service.hasAllActiveScenarioMandatoryFields(scenario)).toBe(false);
    });

    it('returns true when characterProfileText is null', () => {
      const scenario = {
        ...baseScenario,
        scenario_metadata: {
          ...baseScenario.scenario_metadata,
          characterProfileText: null,
        },
      };
      expect(service.hasAllActiveScenarioMandatoryFields(scenario)).toBe(true);
    });

    it('returns true when behaviorInstructions is undefined', () => {
      const scenario = { ...baseScenario };
      expect(service.hasAllActiveScenarioMandatoryFields(scenario)).toBe(true);
    });

    it('returns false when a truly required field (title) is missing', () => {
      const scenario = {
        ...baseScenario,
        scenario_title: '',
      };
      expect(service.hasAllActiveScenarioMandatoryFields(scenario)).toBe(false);
    });

    it('returns false when languageVoices is missing', () => {
      const scenario = {
        ...baseScenario,
        scenario_metadata: {
          ...baseScenario.scenario_metadata,
          languageVoices: undefined,
        },
      };
      expect(service.hasAllActiveScenarioMandatoryFields(scenario)).toBe(false);
    });
  });
});
