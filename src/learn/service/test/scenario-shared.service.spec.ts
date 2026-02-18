import { Test, TestingModule } from '@nestjs/testing';
import { In } from 'typeorm';
import { ScenarioSharedService } from '../scenario-shared.service';
import { ScenariosRepository } from '../../repository/scenario.repository';
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
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { NotFoundException } from '@nestjs/common';
import { Not, IsNull } from 'typeorm';
import { ScenarioBehaviorInstructionRepository } from '../../repository/scenario-behavior-instruction.repository';
import { ScenarioBehaviorInstructionBehaviorRepository } from '../../repository/scenario-behavior-instruction-behavior.repository';
import { BehaviorRepository } from '../../repository/behavior.repository';
import { ConversationalGuardrailsService } from 'src/conversational-guardrails/service/conversational-guardrails.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { SCENARIO_SESSION_PROMPTS } from '../../constants/scenario-session.constants';

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
    };

    const mockPromptSharedService = {
      getPromptsByCodes: jest.fn().mockResolvedValue([]),
    };

    const mockScenarioTranslationsRepository = {
      getUniqueLanguagesFromScenarioTranslations: jest.fn(),
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
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenarioSharedService,
        {
          provide: ScenariosRepository,
          useValue: mockScenariosRepo,
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
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
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
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
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
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
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

      const result = await service.getAdminScenario(1);

      expect(result).toEqual(scenarioResult);
      expect(
        sessionEventSharedService.findSessionEventById,
      ).not.toHaveBeenCalled();
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
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
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
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
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
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
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
      sharedLanguageService.getLanguageByLanguageCode.mockResolvedValue(
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
          instructions: ['Listen actively'],
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
        instructions: ['Listen actively'],
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
      promptSharedService.getPromptsByCodes.mockResolvedValue([]);

      const result = await (service as any).getPromptsForScenarioSession();

      expect(promptSharedService.getPromptsByCodes).toHaveBeenCalledWith(
        SCENARIO_SESSION_PROMPTS,
      );
      expect(result).toEqual({});
    });

    it('should return a map of promptCode -> prompt when prompts are found', async () => {
      const mockPrompts = [
        { promptCode: 'ally_ai_learn_default', prompt: 'Default prompt text' },
        {
          promptCode: 'ally_ai_learn_client_persona_template',
          prompt: 'Persona template text',
        },
        {
          promptCode: 'ally_ai_learn_prosody_generation',
          prompt: 'Prosody generation text',
        },
      ];
      promptSharedService.getPromptsByCodes.mockResolvedValue(mockPrompts);

      const result = await (service as any).getPromptsForScenarioSession();

      expect(promptSharedService.getPromptsByCodes).toHaveBeenCalledWith(
        SCENARIO_SESSION_PROMPTS,
      );
      expect(result).toEqual({
        ally_ai_learn_default: 'Default prompt text',
        ally_ai_learn_client_persona_template: 'Persona template text',
        ally_ai_learn_prosody_generation: 'Prosody generation text',
      });
    });

    it('should correctly overwrite duplicate promptCodes with the last value', async () => {
      const mockPrompts = [
        { promptCode: 'ally_ai_learn_default', prompt: 'First value' },
        { promptCode: 'ally_ai_learn_default', prompt: 'Second value' },
      ];
      promptSharedService.getPromptsByCodes.mockResolvedValue(mockPrompts);

      const result = await (service as any).getPromptsForScenarioSession();

      expect(result).toEqual({
        ally_ai_learn_default: 'Second value',
      });
    });
  });
});
