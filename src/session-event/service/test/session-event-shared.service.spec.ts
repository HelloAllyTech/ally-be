import { Test, TestingModule } from '@nestjs/testing';
import { SessionEventSharedService } from '../session-event-shared.service';
import { SessionEventTranslationsRepository } from '../../repository/session-event-translation.repository';
import { SessionEventRepository } from '../../repository/session-event.repository';

describe('SessionEventSharedService', () => {
  let service: SessionEventSharedService;
  let sessionEventTranslationsRepository: jest.Mocked<SessionEventTranslationsRepository>;
  let sessionEventRepository: jest.Mocked<SessionEventRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionEventSharedService,
        {
          provide: SessionEventTranslationsRepository,
          useValue: {
            getSessionEventTranslationsByForMetaData: jest.fn(),
          },
        },
        {
          provide: SessionEventRepository,
          useValue: {
            getSessionEventsByScenarioId: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SessionEventSharedService>(SessionEventSharedService);
    sessionEventTranslationsRepository = module.get(
      SessionEventTranslationsRepository,
    );
    sessionEventRepository = module.get(SessionEventRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSessionEventsTranslationsByScenarioId', () => {
    it('should filter out events with autoTerminationStatus true', async () => {
      const rawEvents = [
        {
          sessionEvents_id: 'event-1',
          sessionEvents_name: 'Event 1',
          sessionEvents_description: 'Desc 1',
          sessionEvents_score: 80,
          sessionEvents_emoji: '👍',
          sessionEvents_message: 'Msg 1',
          sessionEvents_branchInstruction: 'Branch 1',
          sessionEvents_detectionType: 'TYPE',
          sessionEvents_detectionData: {},
          sessionEvents_visibilityType: 'ACTIVE',
          sessionEvents_speaker: 'SYSTEM',
          sessionEvents_createdAt: new Date(),
          sessionEvents_updatedAt: new Date(),
          sessionEvents_eventCode: 'E1',
          scenarioEvents_score: null,
          scenarioEvents_feedbackStatus: true,
          scenarioEvents_emoji: null,
          scenarioEvents_message: null,
          scenarioEvents_branchingStatus: true,
          scenarioEvents_branchInstruction: null,
          scenarioEvents_detectionConfig: null,
          scenarioEvents_checklistVisibilityStatus: null,
          autoTerminationStatus: false,
        },
        {
          sessionEvents_id: 'event-2',
          sessionEvents_name: 'Termination',
          sessionEvents_description: null,
          sessionEvents_score: null,
          sessionEvents_emoji: null,
          sessionEvents_message: null,
          sessionEvents_branchInstruction: null,
          sessionEvents_detectionType: 'TYPE',
          sessionEvents_detectionData: null,
          sessionEvents_visibilityType: 'ACTIVE',
          sessionEvents_speaker: null,
          sessionEvents_createdAt: new Date(),
          sessionEvents_updatedAt: new Date(),
          sessionEvents_eventCode: 'E2',
          scenarioEvents_score: null,
          scenarioEvents_feedbackStatus: null,
          scenarioEvents_emoji: null,
          scenarioEvents_message: null,
          scenarioEvents_branchingStatus: null,
          scenarioEvents_branchInstruction: null,
          scenarioEvents_detectionConfig: null,
          scenarioEvents_checklistVisibilityStatus: null,
          autoTerminationStatus: true,
        },
      ];

      sessionEventTranslationsRepository.getSessionEventTranslationsByForMetaData.mockResolvedValue(
        rawEvents as any,
      );

      const result = await service.getSessionEventsTranslationsByScenarioId(
        1,
        1,
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event-1');
    });

    it('should use scenario overrides when feedbackStatus is true', async () => {
      const rawEvents = [
        {
          sessionEvents_id: 'event-1',
          sessionEvents_name: 'Event 1',
          sessionEvents_description: 'Desc',
          sessionEvents_score: 80,
          sessionEvents_emoji: '👍',
          sessionEvents_message: 'Default message',
          sessionEvents_branchInstruction: 'Default branch',
          sessionEvents_detectionType: 'TYPE',
          sessionEvents_detectionData: { key: 'value' },
          sessionEvents_visibilityType: 'ACTIVE',
          sessionEvents_speaker: 'SYSTEM',
          sessionEvents_createdAt: new Date('2024-01-01'),
          sessionEvents_updatedAt: new Date('2024-01-01'),
          sessionEvents_eventCode: 'E1',
          scenarioEvents_score: 90,
          scenarioEvents_feedbackStatus: true,
          scenarioEvents_emoji: '🎉',
          scenarioEvents_message: 'Custom message',
          scenarioEvents_branchingStatus: true,
          scenarioEvents_branchInstruction: 'Custom branch',
          scenarioEvents_detectionConfig: { startTime: 0 },
          scenarioEvents_checklistVisibilityStatus: true,
          autoTerminationStatus: false,
        },
      ];

      sessionEventTranslationsRepository.getSessionEventTranslationsByForMetaData.mockResolvedValue(
        rawEvents as any,
      );

      const result = await service.getSessionEventsTranslationsByScenarioId(
        1,
        1,
      );

      expect(result[0].score).toBe(90);
      expect(result[0].emoji).toBe('🎉');
      expect(result[0].message).toBe('Custom message');
      expect(result[0].branchInstruction).toBe('Custom branch');
      expect((result[0] as any).feedbackStatus).toBe(true);
    });

    it('should use session defaults when feedbackStatus is false', async () => {
      const rawEvents = [
        {
          sessionEvents_id: 'event-1',
          sessionEvents_name: 'Event 1',
          sessionEvents_description: 'Desc',
          sessionEvents_score: 75,
          sessionEvents_emoji: '✅',
          sessionEvents_message: 'Session message',
          sessionEvents_branchInstruction: 'Session branch',
          sessionEvents_detectionType: 'TYPE',
          sessionEvents_detectionData: null,
          sessionEvents_visibilityType: 'PASSIVE',
          sessionEvents_speaker: 'SYSTEM',
          sessionEvents_createdAt: new Date(),
          sessionEvents_updatedAt: new Date(),
          sessionEvents_eventCode: 'E1',
          scenarioEvents_score: 85,
          scenarioEvents_feedbackStatus: false,
          scenarioEvents_emoji: '🚀',
          scenarioEvents_message: 'Scenario message',
          scenarioEvents_branchingStatus: false,
          scenarioEvents_branchInstruction: 'Scenario branch',
          scenarioEvents_detectionConfig: null,
          scenarioEvents_checklistVisibilityStatus: false,
          autoTerminationStatus: false,
        },
      ];

      sessionEventTranslationsRepository.getSessionEventTranslationsByForMetaData.mockResolvedValue(
        rawEvents as any,
      );

      const result = await service.getSessionEventsTranslationsByScenarioId(
        1,
        1,
      );

      expect(result[0].score).toBe(85);
      expect(result[0].emoji).toBe('✅');
      expect(result[0].message).toBe('Session message');
      expect(result[0].branchInstruction).toBe(null);
      expect((result[0] as any).feedbackStatus).toBe(false);
    });

    it('should fall back to sessionEvents_score when scenarioEvents_score is null', async () => {
      const rawEvents = [
        {
          sessionEvents_id: 'event-1',
          sessionEvents_name: 'Event 1',
          sessionEvents_description: null,
          sessionEvents_score: 70,
          sessionEvents_emoji: '👍',
          sessionEvents_message: 'Msg',
          sessionEvents_branchInstruction: null,
          sessionEvents_detectionType: 'TYPE',
          sessionEvents_detectionData: null,
          sessionEvents_visibilityType: 'ACTIVE',
          sessionEvents_speaker: null,
          sessionEvents_createdAt: new Date(),
          sessionEvents_updatedAt: new Date(),
          sessionEvents_eventCode: 'E1',
          scenarioEvents_score: null,
          scenarioEvents_feedbackStatus: true,
          scenarioEvents_emoji: null,
          scenarioEvents_message: null,
          scenarioEvents_branchingStatus: true,
          scenarioEvents_branchInstruction: null,
          scenarioEvents_detectionConfig: null,
          scenarioEvents_checklistVisibilityStatus: null,
          autoTerminationStatus: false,
        },
      ];

      sessionEventTranslationsRepository.getSessionEventTranslationsByForMetaData.mockResolvedValue(
        rawEvents as any,
      );

      const result = await service.getSessionEventsTranslationsByScenarioId(
        1,
        1,
      );

      expect(result[0].score).toBe(70);
    });
  });

  describe('getSessionEventsByScenarioId', () => {
    it('should map raw repository events to SessionEvents shape with scenario overrides when feedbackStatus true', async () => {
      const rawEvents = [
        {
          sessionEvents_id: 'event-1',
          sessionEvents_name: 'Event 1',
          sessionEvents_description: 'Desc',
          sessionEvents_score: 80,
          sessionEvents_emoji: '👍',
          sessionEvents_message: 'Default',
          sessionEvents_branchInstruction: 'Default branch',
          sessionEvents_detectionType: 'TYPE',
          sessionEvents_detectionData: {},
          sessionEvents_visibilityType: 'ACTIVE',
          sessionEvents_speaker: 'SYSTEM',
          sessionEvents_createdAt: new Date('2024-01-01'),
          sessionEvents_updatedAt: new Date('2024-01-01'),
          sessionEvents_eventCode: 'E1',
          scenarioEvents_score: 95,
          scenarioEvents_feedbackStatus: true,
          scenarioEvents_emoji: '🎯',
          scenarioEvents_message: 'Custom',
          scenarioEvents_branchingStatus: true,
          scenarioEvents_branchInstruction: 'Custom branch',
          scenarioEvents_detectionConfig: {},
          scenarioEvents_checklistVisibilityStatus: true,
        },
      ];

      sessionEventRepository.getSessionEventsByScenarioId.mockResolvedValue(
        rawEvents as any,
      );

      const result = await service.getSessionEventsByScenarioId(1);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'event-1',
        name: 'Event 1',
        description: 'Desc',
        score: 95,
        emoji: '🎯',
        message: 'Custom',
        branchInstruction: 'Custom branch',
        feedbackStatus: true,
        eventCode: 'E1',
      });
      expect(
        sessionEventRepository.getSessionEventsByScenarioId,
      ).toHaveBeenCalledWith(1);
    });

    it('should use session defaults when feedbackStatus is false and set branchInstruction to null', async () => {
      const rawEvents = [
        {
          sessionEvents_id: 'event-1',
          sessionEvents_name: 'Event 1',
          sessionEvents_description: null,
          sessionEvents_score: 70,
          sessionEvents_emoji: '✅',
          sessionEvents_message: 'Session msg',
          sessionEvents_branchInstruction: 'Would be used if branching true',
          sessionEvents_detectionType: 'TYPE',
          sessionEvents_detectionData: null,
          sessionEvents_visibilityType: 'PASSIVE',
          sessionEvents_speaker: null,
          sessionEvents_createdAt: new Date(),
          sessionEvents_updatedAt: new Date(),
          sessionEvents_eventCode: 'E1',
          scenarioEvents_score: null,
          scenarioEvents_feedbackStatus: false,
          scenarioEvents_emoji: null,
          scenarioEvents_message: null,
          scenarioEvents_branchingStatus: false,
          scenarioEvents_branchInstruction: null,
          scenarioEvents_detectionConfig: null,
          scenarioEvents_checklistVisibilityStatus: null,
        },
      ];

      sessionEventRepository.getSessionEventsByScenarioId.mockResolvedValue(
        rawEvents as any,
      );

      const result = await service.getSessionEventsByScenarioId(1);

      expect(result[0].emoji).toBe('✅');
      expect(result[0].message).toBe('Session msg');
      expect(result[0].branchInstruction).toBe(null);
    });
  });

  describe('findByIds', () => {
    it('should return empty array when ids is empty', async () => {
      const result = await service.findByIds([]);

      expect(result).toEqual([]);
      expect(sessionEventRepository.find).not.toHaveBeenCalled();
    });

    it('should call repository find with In(ids) when ids provided', async () => {
      const ids = ['id-1', 'id-2'];
      const events = [
        { id: 'id-1', name: 'E1' },
        { id: 'id-2', name: 'E2' },
      ];
      sessionEventRepository.find.mockResolvedValue(events as any);

      const result = await service.findByIds(ids);

      expect(result).toEqual(events);
      expect(sessionEventRepository.find).toHaveBeenCalledWith({
        where: { id: expect.anything() },
      });
    });
  });

  describe('findSessionEventById', () => {
    it('should return event when found', async () => {
      const event = { id: 'event-1', name: 'Test Event' };
      sessionEventRepository.findOne.mockResolvedValue(event as any);

      const result = await service.findSessionEventById('event-1');

      expect(result).toEqual(event);
      expect(sessionEventRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'event-1' },
      });
    });

    it('should return null when event not found', async () => {
      sessionEventRepository.findOne.mockResolvedValue(null);

      const result = await service.findSessionEventById('non-existent');

      expect(result).toBeNull();
    });
  });
});
