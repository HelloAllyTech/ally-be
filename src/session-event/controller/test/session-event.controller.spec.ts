import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { SessionEventController } from '../session-event.controller';
import { SessionEventService } from '../../service/session-event.service';
import { CreateSessionEventsDto } from '../../dto/create-session-events.dto';
import { UpdateSessionEventDto } from '../../dto/update-session-event.dto';
import { CreateSessionEventDto } from '../../dto/create-session-event.dto';
import { SessionEvents } from '../../entity/session-events.entity';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';
import { SessionEventDetectionType } from 'src/session-event/enum/session-event-detection-type.enum';
import { SessionEventSortBy } from 'src/session-event/enum/session-event-sort-by.enum';
import { SortOrder } from 'src/chat/dto/call-log.request.dto';

describe('SessionEventController', () => {
  let controller: SessionEventController;
  let sessionEventService: jest.Mocked<SessionEventService>;

  const mockSessionEvent: SessionEvents = {
    id: 'event-1',
    name: 'Test Event',
    description: 'Test event description',
    score: 85,
    emoji: '👍',
    message: 'Great job!',
    branchInstruction: 'Continue with next step',
    detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
    visibilityType: SessionEventVisibilityType.ACTIVE,
    createdAt: new Date('2024-01-01T10:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
  };

  const mockCreateSessionEventDto: CreateSessionEventDto = {
    id: 'event-1',
    name: 'Test Event',
    description: 'Test event description',
    score: 85,
    emoji: '👍',
    message: 'Great job!',
    branchInstruction: 'Continue with next step',
    detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
    visibilityType: SessionEventVisibilityType.ACTIVE,
    sentences: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
  };

  const mockCreateSessionEventsDto: CreateSessionEventsDto = {
    events: [mockCreateSessionEventDto],
  };

  const mockUpdateSessionEventDto: UpdateSessionEventDto = {
    name: 'Updated Event',
    description: 'Updated description',
    score: 90,
    emoji: '🎉',
    message: 'Excellent work!',
    branchInstruction: 'Move to advanced level',
  };

  beforeEach(async () => {
    const mockSessionEventService = {
      createSessionEvents: jest.fn(),
      updateSessionEvent: jest.fn(),
      getAllSessionEvents: jest.fn(),
    };

    const mockPermissionsService = {
      getUserRoles: jest.fn().mockResolvedValue(['SUPER_ADMIN']),
    };

    const mockReflector = {
      get: jest.fn(),
      getAll: jest.fn(),
      getAllAndOverride: jest.fn().mockReturnValue(['SUPER_ADMIN']),
      getAllAndMerge: jest.fn(),
    };

    const mockRolesGuard = {
      canActivate: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionEventController],
      providers: [
        {
          provide: SessionEventService,
          useValue: mockSessionEventService,
        },
        {
          provide: PermissionsService,
          useValue: mockPermissionsService,
        },
        {
          provide: Reflector,
          useValue: mockReflector,
        },
        {
          provide: RolesGuard,
          useValue: mockRolesGuard,
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(mockRolesGuard)
      .compile();

    controller = module.get<SessionEventController>(SessionEventController);
    sessionEventService = module.get(SessionEventService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSessionEvents', () => {
    it('should create session events successfully', async () => {
      const expectedResult = [mockSessionEvent];
      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(
        mockCreateSessionEventsDto,
      );

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        mockCreateSessionEventsDto.events,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should create multiple session events successfully', async () => {
      const multipleEventsDto: CreateSessionEventsDto = {
        events: [
          mockCreateSessionEventDto,
          {
            ...mockCreateSessionEventDto,
            id: 'event-2',
            name: 'Second Event',
          },
        ],
      };
      const expectedResult = [
        mockSessionEvent,
        { ...mockSessionEvent, id: 'event-2', name: 'Second Event' },
      ];

      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(multipleEventsDto);

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        multipleEventsDto.events,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle empty events array', async () => {
      const emptyEventsDto: CreateSessionEventsDto = {
        events: [],
      };
      const expectedResult: SessionEvents[] = [];

      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(emptyEventsDto);

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith([]);
      expect(result).toEqual(expectedResult);
    });

    it('should create session events with minimal required fields', async () => {
      const minimalEventDto: CreateSessionEventDto = {
        id: 'minimal-event',
        name: 'Minimal Event',
        description: 'Minimal description',
        score: 50,
        emoji: '⭐',
        message: 'Basic message',
        detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
        visibilityType: SessionEventVisibilityType.ACTIVE,
        sentences: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
      };
      const minimalEventsDto: CreateSessionEventsDto = {
        events: [minimalEventDto],
      };
      const expectedResult = [
        {
          ...mockSessionEvent,
          id: 'minimal-event',
          name: 'Minimal Event',
          description: 'Minimal description',
          score: 50,
          emoji: '⭐',
          message: 'Basic message',
          branchInstruction: undefined,
        },
      ];

      sessionEventService.createSessionEvents.mockResolvedValue(
        expectedResult as any,
      );

      const result = await controller.createSessionEvents(minimalEventsDto);

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith([
        minimalEventDto,
      ]);
      expect(result).toEqual(expectedResult);
    });

    it('should create session events with all optional fields', async () => {
      const fullEventDto: CreateSessionEventDto = {
        id: 'full-event',
        name: 'Full Event',
        description: 'Complete description',
        score: 100,
        emoji: '🏆',
        message: 'Perfect execution!',
        branchInstruction: 'Proceed to final stage',
        detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
        visibilityType: SessionEventVisibilityType.ACTIVE,
        sentences: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
      };
      const fullEventsDto: CreateSessionEventsDto = {
        events: [fullEventDto],
      };
      const expectedResult = [
        {
          ...mockSessionEvent,
          id: 'full-event',
          name: 'Full Event',
          description: 'Complete description',
          score: 100,
          emoji: '🏆',
          message: 'Perfect execution!',
          branchInstruction: 'Proceed to final stage',
        },
      ];

      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(fullEventsDto);

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith([
        fullEventDto,
      ]);
      expect(result).toEqual(expectedResult);
    });

    it('should handle database constraint violation', async () => {
      const constraintError = new Error(
        'Duplicate key value violates unique constraint',
      );
      sessionEventService.createSessionEvents.mockRejectedValue(
        constraintError,
      );

      await expect(
        controller.createSessionEvents(mockCreateSessionEventsDto),
      ).rejects.toThrow('Duplicate key value violates unique constraint');

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        mockCreateSessionEventsDto.events,
      );
    });

    it('should handle large batch of events', async () => {
      const largeEventsDto: CreateSessionEventsDto = {
        events: Array.from({ length: 50 }, (_, i) => ({
          ...mockCreateSessionEventDto,
          id: `event-${i + 1}`,
          name: `Event ${i + 1}`,
        })),
      };
      const expectedResult = largeEventsDto.events.map((event) => ({
        ...mockSessionEvent,
        id: event.id,
        name: event.name,
      }));

      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(largeEventsDto);

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        largeEventsDto.events,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should create events with different score ranges', async () => {
      const scoreVariationsDto: CreateSessionEventsDto = {
        events: [
          { ...mockCreateSessionEventDto, id: 'low-score', score: 0 },
          { ...mockCreateSessionEventDto, id: 'mid-score', score: 50 },
          { ...mockCreateSessionEventDto, id: 'high-score', score: 100 },
        ],
      };
      const expectedResult = [
        { ...mockSessionEvent, id: 'low-score', score: 0 },
        { ...mockSessionEvent, id: 'mid-score', score: 50 },
        { ...mockSessionEvent, id: 'high-score', score: 100 },
      ];

      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(scoreVariationsDto);

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        scoreVariationsDto.events,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should create events with special characters in fields', async () => {
      const specialCharsDto: CreateSessionEventsDto = {
        events: [
          {
            ...mockCreateSessionEventDto,
            id: 'special-chars-event',
            name: 'Event with "quotes" & symbols',
            description: 'Description with émojis 🎉 and spëcial chars',
            emoji: '🌟',
            message: 'Message with <tags> and symbols!@#$%^&*()',
            branchInstruction: 'Branch with [brackets] and {braces}',
          },
        ],
      };
      const expectedResult = [
        {
          ...mockSessionEvent,
          id: 'special-chars-event',
          name: 'Event with "quotes" & symbols',
          description: 'Description with émojis 🎉 and spëcial chars',
          emoji: '🌟',
          message: 'Message with <tags> and symbols!@#$%^&*()',
          branchInstruction: 'Branch with [brackets] and {braces}',
        },
      ];

      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(specialCharsDto);

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        specialCharsDto.events,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('updateSessionEvents', () => {
    const eventId = 'event-1';

    it('should update session event successfully', async () => {
      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        mockUpdateSessionEventDto,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
      );
      expect(result).toBe(true);
    });

    it('should return false when update fails', async () => {
      sessionEventService.updateSessionEvent.mockResolvedValue(false);

      const result = await controller.updateSessionEvents(
        eventId,
        mockUpdateSessionEventDto,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
      );
      expect(result).toBe(false);
    });

    it('should update with partial data', async () => {
      const partialUpdate: UpdateSessionEventDto = {
        name: 'Partially Updated Event',
        score: 95,
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        partialUpdate,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        partialUpdate,
      );
      expect(result).toBe(true);
    });

    it('should update with empty object', async () => {
      const emptyUpdate: UpdateSessionEventDto = {};

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(eventId, emptyUpdate);

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        emptyUpdate,
      );
      expect(result).toBe(true);
    });

    it('should update only the name field', async () => {
      const nameOnlyUpdate: UpdateSessionEventDto = {
        name: 'New Name Only',
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        nameOnlyUpdate,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        nameOnlyUpdate,
      );
      expect(result).toBe(true);
    });

    it('should update only the score field', async () => {
      const scoreOnlyUpdate: UpdateSessionEventDto = {
        score: 88,
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        scoreOnlyUpdate,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        scoreOnlyUpdate,
      );
      expect(result).toBe(true);
    });

    it('should update only the emoji field', async () => {
      const emojiOnlyUpdate: UpdateSessionEventDto = {
        emoji: '🚀',
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        emojiOnlyUpdate,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        emojiOnlyUpdate,
      );
      expect(result).toBe(true);
    });

    it('should update with special characters in ID', async () => {
      const specialId = 'event-with-special-chars_123!@#';

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        specialId,
        mockUpdateSessionEventDto,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        specialId,
        mockUpdateSessionEventDto,
      );
      expect(result).toBe(true);
    });

    it('should handle service error during update', async () => {
      const error = new Error('Service update failed');
      sessionEventService.updateSessionEvent.mockRejectedValue(error);

      await expect(
        controller.updateSessionEvents(eventId, mockUpdateSessionEventDto),
      ).rejects.toThrow('Service update failed');

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
      );
    });

    it('should handle NotFoundException from service', async () => {
      const notFoundError = new Error('Session Event not found');
      sessionEventService.updateSessionEvent.mockRejectedValue(notFoundError);

      await expect(
        controller.updateSessionEvents(eventId, mockUpdateSessionEventDto),
      ).rejects.toThrow('Session Event not found');

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
      );
    });

    it('should update with maximum score value', async () => {
      const maxScoreUpdate: UpdateSessionEventDto = {
        score: Number.MAX_SAFE_INTEGER,
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        maxScoreUpdate,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        maxScoreUpdate,
      );
      expect(result).toBe(true);
    });

    it('should update with minimum score value', async () => {
      const minScoreUpdate: UpdateSessionEventDto = {
        score: 0,
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        minScoreUpdate,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        minScoreUpdate,
      );
      expect(result).toBe(true);
    });

    it('should update with long text fields', async () => {
      const longTextUpdate: UpdateSessionEventDto = {
        name: 'A'.repeat(1000),
        description: 'B'.repeat(2000),
        message: 'C'.repeat(1500),
        branchInstruction: 'D'.repeat(500),
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        longTextUpdate,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        longTextUpdate,
      );
      expect(result).toBe(true);
    });

    it('should update with Unicode emoji characters', async () => {
      const unicodeUpdate: UpdateSessionEventDto = {
        emoji: '🎯🎪🎨🎭🎪',
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        unicodeUpdate,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        unicodeUpdate,
      );
      expect(result).toBe(true);
    });
  });

  describe('getAllSessionEvents', () => {
    const mockResult = { data: [mockSessionEvent] };

    it('should get all session events without filters', async () => {
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents();

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        {
          limit: undefined,
          offset: undefined,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
      );
      expect(result).toEqual(mockResult);
    });

    it('should get session events with visibility type filter', async () => {
      const visibilityType = SessionEventVisibilityType.ACTIVE;
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(visibilityType);

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        visibilityType,
        {
          limit: undefined,
          offset: undefined,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
      );
      expect(result).toEqual(mockResult);
    });

    it('should get session events with pagination parameters', async () => {
      const limit = 10;
      const offset = 5;
      const sortBy = SessionEventSortBy.NAME;
      const order = SortOrder.ASC;
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(
        undefined,
        limit,
        offset,
        sortBy,
        order,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        {
          limit,
          offset,
          sortBy,
          order,
        },
      );
      expect(result).toEqual(mockResult);
    });

    it('should get session events with all parameters', async () => {
      const visibilityType = SessionEventVisibilityType.PASSIVE;
      const limit = 20;
      const offset = 10;
      const sortBy = SessionEventSortBy.SCORE;
      const order = SortOrder.DESC;
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(
        visibilityType,
        limit,
        offset,
        sortBy,
        order,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        visibilityType,
        {
          limit,
          offset,
          sortBy,
          order,
        },
      );
      expect(result).toEqual(mockResult);
    });

    it('should handle empty result from service', async () => {
      const emptyResult = { data: [] };
      sessionEventService.getAllSessionEvents.mockResolvedValue(emptyResult);

      const result = await controller.getAllSessionEvents();

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        {
          limit: undefined,
          offset: undefined,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
      );
      expect(result).toEqual(emptyResult);
    });

    it('should handle service error', async () => {
      const error = new Error('Service error');
      sessionEventService.getAllSessionEvents.mockRejectedValue(error);

      await expect(controller.getAllSessionEvents()).rejects.toThrow(
        'Service error',
      );
      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        {
          limit: undefined,
          offset: undefined,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
      );
    });

    it('should use default sort parameters when not provided', async () => {
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(
        SessionEventVisibilityType.ACTIVE,
        10,
        0,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        SessionEventVisibilityType.ACTIVE,
        {
          limit: 10,
          offset: 0,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
      );
      expect(result).toEqual(mockResult);
    });

    it('should handle zero limit and offset', async () => {
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(
        undefined,
        0,
        0,
        SessionEventSortBy.NAME,
        SortOrder.ASC,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        {
          limit: 0,
          offset: 0,
          sortBy: SessionEventSortBy.NAME,
          order: SortOrder.ASC,
        },
      );
      expect(result).toEqual(mockResult);
    });
  });
});
