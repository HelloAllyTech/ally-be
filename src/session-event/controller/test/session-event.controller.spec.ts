import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { SessionEventController } from '../session-event.controller';
import { SessionEventService } from '../../service/session-event.service';
import { CreateSessionEventsDto } from '../../dto/create-session-events.dto';
import { SessionEvents } from '../../entity/session-events.entity';
import {
  CreateSessionEventDto,
  SessionEventResponseDto,
  UpdateSessionEventDto,
} from '../../dto/session-event.dto';
import { PermissionsService } from '../../../authorization/service/permissions.service';
import { FeatureToggleService } from '../../../authorization/service/feature-toggle.service';
import { TenantFeatureService } from '../../../authorization/service/tenant-feature.service';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserService } from '../../../user/service/user.service';
import { AppConfigService } from '../../../config/config.service';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';
import { SessionEventDetectionType } from 'src/session-event/enum/session-event-detection.enum';
import { SessionEventSortBy } from 'src/session-event/enum/session-event-sort-by.enum';
import { SortOrder } from 'src/chat/dto/call-log.request.dto';
import { TokenUser } from 'src/auth/type/auth.types';

describe('SessionEventController', () => {
  let controller: SessionEventController;
  let sessionEventService: jest.Mocked<SessionEventService>;

  const mockUser: TokenUser = {
    id: 1,
    username: 'testuser',
    tenantId: 'tenant-1',
  };

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
    eventCode: 'SS1',
  };

  const mockSessionEventResponse: SessionEventResponseDto & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
  } = {
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
    detectionData: {
      sentences: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
    },
  };

  const mockCreateSessionEventDto: CreateSessionEventDto = {
    name: 'Test Event',
    description: 'Test event description',
    score: 85,
    emoji: '👍',
    message: 'Great job!',
    branchInstruction: 'Continue with next step',
    detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
    visibilityType: SessionEventVisibilityType.ACTIVE,
    detectionData: {
      sentences: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
    },
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
      deleteSessionEvents: jest.fn(),
      translatePassiveSessionEvents: jest.fn(),
      getUniqueTags: jest.fn(),
    };

    const mockPermissionsService = {
      getUserRoles: jest.fn().mockResolvedValue(['SUPER_ADMIN']),
    };

    const mockUserService = {
      getTermsAndAgreementApproval: jest.fn().mockResolvedValue(true),
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
          provide: UserService,
          useValue: mockUserService,
        },
        {
          provide: AppConfigService,
          useValue: {
            featureFlag: {
              termsAndAgreement: false,
            },
          },
        },
        {
          provide: Reflector,
          useValue: mockReflector,
        },
        {
          provide: RolesGuard,
          useValue: mockRolesGuard,
        },
        {
          provide: FeatureToggleService,
          useValue: { hasToggle: jest.fn().mockResolvedValue(true) },
        },
        {
          // FeatureToggleGuard's org-level branch. Off here — every route in
          // this suite grants via the per-user toggle above.
          provide: TenantFeatureService,
          useValue: { isEnabledForTenant: jest.fn().mockResolvedValue(false) },
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
        mockUser,
      );

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        mockCreateSessionEventsDto.events,
        mockUser.id,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should create multiple session events successfully', async () => {
      const multipleEventsDto: CreateSessionEventsDto = {
        events: [
          mockCreateSessionEventDto,
          {
            ...mockCreateSessionEventDto,
            name: 'Second Event',
          },
        ],
      };
      const expectedResult = [
        mockSessionEvent,
        { ...mockSessionEvent, id: 'event-2', name: 'Second Event' },
      ];

      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(
        multipleEventsDto,
        mockUser,
      );

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        multipleEventsDto.events,
        mockUser.id,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle empty events array', async () => {
      const emptyEventsDto: CreateSessionEventsDto = {
        events: [],
      };
      const expectedResult: SessionEvents[] = [];

      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(
        emptyEventsDto,
        mockUser,
      );

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        [],
        mockUser.id,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should create session events with minimal required fields', async () => {
      const minimalEventDto: CreateSessionEventDto = {
        name: 'Minimal Event',
        description: 'Minimal description',
        score: 50,
        emoji: '⭐',
        message: 'Basic message',
        detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
        visibilityType: SessionEventVisibilityType.ACTIVE,
        detectionData: {
          sentences: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
        },
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

      const result = await controller.createSessionEvents(
        minimalEventsDto,
        mockUser,
      );

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        [minimalEventDto],
        mockUser.id,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should create session events with all optional fields', async () => {
      const fullEventDto: CreateSessionEventDto = {
        name: 'Full Event',
        description: 'Complete description',
        score: 100,
        emoji: '🏆',
        message: 'Perfect execution!',
        branchInstruction: 'Proceed to final stage',
        detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
        visibilityType: SessionEventVisibilityType.ACTIVE,
        detectionData: {
          sentences: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
        },
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

      const result = await controller.createSessionEvents(
        fullEventsDto,
        mockUser,
      );

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        [fullEventDto],
        mockUser.id,
      );
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
        controller.createSessionEvents(mockCreateSessionEventsDto, mockUser),
      ).rejects.toThrow('Duplicate key value violates unique constraint');

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        mockCreateSessionEventsDto.events,
        mockUser.id,
      );
    });

    it('should handle large batch of events', async () => {
      const largeEventsDto: CreateSessionEventsDto = {
        events: Array.from({ length: 50 }, (_, i) => ({
          ...mockCreateSessionEventDto,
          name: `Event ${i + 1}`,
        })),
      };
      const expectedResult = largeEventsDto.events.map((event, i) => ({
        ...mockSessionEvent,
        id: `event-${i + 1}`,
        name: event.name,
      }));

      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(
        largeEventsDto,
        mockUser,
      );

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        largeEventsDto.events,
        mockUser.id,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should create events with different score ranges', async () => {
      const scoreVariationsDto: CreateSessionEventsDto = {
        events: [
          { ...mockCreateSessionEventDto, score: 0 },
          { ...mockCreateSessionEventDto, score: 50 },
          { ...mockCreateSessionEventDto, score: 100 },
        ],
      };
      const expectedResult = [
        { ...mockSessionEvent, id: 'low-score', score: 0 },
        { ...mockSessionEvent, id: 'mid-score', score: 50 },
        { ...mockSessionEvent, id: 'high-score', score: 100 },
      ];

      sessionEventService.createSessionEvents.mockResolvedValue(expectedResult);

      const result = await controller.createSessionEvents(
        scoreVariationsDto,
        mockUser,
      );

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        scoreVariationsDto.events,
        mockUser.id,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should create events with special characters in fields', async () => {
      const specialCharsDto: CreateSessionEventsDto = {
        events: [
          {
            ...mockCreateSessionEventDto,
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

      const result = await controller.createSessionEvents(
        specialCharsDto,
        mockUser,
      );

      expect(sessionEventService.createSessionEvents).toHaveBeenCalledWith(
        specialCharsDto.events,
        mockUser.id,
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
        mockUser,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
        mockUser.id,
      );
      expect(result).toBe(true);
    });

    it('should return false when update fails', async () => {
      sessionEventService.updateSessionEvent.mockResolvedValue(false);

      const result = await controller.updateSessionEvents(
        eventId,
        mockUpdateSessionEventDto,
        mockUser,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
        mockUser.id,
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
        mockUser,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        partialUpdate,
        mockUser.id,
      );
      expect(result).toBe(true);
    });

    it('should handle service error during update', async () => {
      const error = new Error('Service update failed');
      sessionEventService.updateSessionEvent.mockRejectedValue(error);

      await expect(
        controller.updateSessionEvents(
          eventId,
          mockUpdateSessionEventDto,
          mockUser,
        ),
      ).rejects.toThrow('Service update failed');

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
        mockUser.id,
      );
    });

    it('should handle NotFoundException from service', async () => {
      const notFoundError = new Error('Session Event not found');
      sessionEventService.updateSessionEvent.mockRejectedValue(notFoundError);

      await expect(
        controller.updateSessionEvents(
          eventId,
          mockUpdateSessionEventDto,
          mockUser,
        ),
      ).rejects.toThrow('Session Event not found');

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
        mockUser.id,
      );
    });

    it('should update with maximum score value', async () => {
      const maxScoreUpdate: UpdateSessionEventDto = {
        score: Number.MAX_SAFE_INTEGER,
        name: 'Updated Event',
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        maxScoreUpdate,
        mockUser,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        maxScoreUpdate,
        mockUser.id,
      );
      expect(result).toBe(true);
    });

    it('should update with minimum score value', async () => {
      const minScoreUpdate: UpdateSessionEventDto = {
        score: 0,
        name: 'Updated Event',
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        minScoreUpdate,
        mockUser,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        minScoreUpdate,
        mockUser.id,
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
        mockUser,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        longTextUpdate,
        mockUser.id,
      );
      expect(result).toBe(true);
    });

    it('should update with Unicode emoji characters', async () => {
      const unicodeUpdate: UpdateSessionEventDto = {
        emoji: '🎯🎪🎨🎭🎪',
        name: 'Updated Event',
      };

      sessionEventService.updateSessionEvent.mockResolvedValue(true);

      const result = await controller.updateSessionEvents(
        eventId,
        unicodeUpdate,
        mockUser,
      );

      expect(sessionEventService.updateSessionEvent).toHaveBeenCalledWith(
        eventId,
        unicodeUpdate,
        mockUser.id,
      );
      expect(result).toBe(true);
    });
  });

  describe('getAllSessionEvents', () => {
    const mockResult = { data: [mockSessionEventResponse] };

    it('should get all session events without filters', async () => {
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(mockUser);

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        undefined,
        {
          limit: undefined,
          offset: undefined,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
        mockUser.id,
      );
      expect(result).toEqual(mockResult);
    });

    it('should get session events with visibility type filter', async () => {
      const visibilityType = SessionEventVisibilityType.ACTIVE;
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(
        mockUser,
        visibilityType,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        visibilityType,
        undefined,
        {
          limit: undefined,
          offset: undefined,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
        mockUser.id,
      );
      expect(result).toEqual(mockResult);
    });

    it('should get session events with searchName filter', async () => {
      const searchName = 'Test Event';
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(
        mockUser,
        undefined,
        searchName,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        searchName,
        {
          limit: undefined,
          offset: undefined,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
        mockUser.id,
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
        mockUser,
        undefined,
        undefined,
        limit,
        offset,
        sortBy,
        order,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        undefined,
        {
          limit,
          offset,
          sortBy,
          order,
        },
        mockUser.id,
      );
      expect(result).toEqual(mockResult);
    });

    it('should get session events with all parameters', async () => {
      const visibilityType = SessionEventVisibilityType.PASSIVE;
      const searchName = 'Event Name';
      const limit = 20;
      const offset = 10;
      const sortBy = SessionEventSortBy.SCORE;
      const order = SortOrder.DESC;
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(
        mockUser,
        visibilityType,
        searchName,
        limit,
        offset,
        sortBy,
        order,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        visibilityType,
        searchName,
        {
          limit,
          offset,
          sortBy,
          order,
        },
        mockUser.id,
      );
      expect(result).toEqual(mockResult);
    });

    it('should handle empty result from service', async () => {
      const emptyResult: { data: SessionEventResponseDto[] } = { data: [] };
      sessionEventService.getAllSessionEvents.mockResolvedValue(emptyResult);

      const result = await controller.getAllSessionEvents(mockUser);

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        undefined,
        {
          limit: undefined,
          offset: undefined,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
        mockUser.id,
      );
      expect(result).toEqual(emptyResult);
    });

    it('should handle service error', async () => {
      const error = new Error('Service error');
      sessionEventService.getAllSessionEvents.mockRejectedValue(error);

      await expect(controller.getAllSessionEvents(mockUser)).rejects.toThrow(
        'Service error',
      );
      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        undefined,
        {
          limit: undefined,
          offset: undefined,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
        mockUser.id,
      );
    });

    it('should use default sort parameters when not provided', async () => {
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(
        mockUser,
        SessionEventVisibilityType.ACTIVE,
        undefined,
        10,
        0,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        SessionEventVisibilityType.ACTIVE,
        undefined,
        {
          limit: 10,
          offset: 0,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
        mockUser.id,
      );
      expect(result).toEqual(mockResult);
    });

    it('should handle zero limit and offset', async () => {
      sessionEventService.getAllSessionEvents.mockResolvedValue(mockResult);

      const result = await controller.getAllSessionEvents(
        mockUser,
        undefined,
        undefined,
        0,
        0,
        SessionEventSortBy.NAME,
        SortOrder.ASC,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        undefined,
        {
          limit: 0,
          offset: 0,
          sortBy: SessionEventSortBy.NAME,
          order: SortOrder.ASC,
        },
        mockUser.id,
      );
      expect(result).toEqual(mockResult);
    });

    it('should handle visibility type and searchName together', async () => {
      const visibilityType = SessionEventVisibilityType.ACTIVE;
      const searchName = 'Test';
      sessionEventService.getAllSessionEvents.mockResolvedValue({
        data: [mockSessionEventResponse],
      });

      const result = await controller.getAllSessionEvents(
        mockUser,
        visibilityType,
        searchName,
      );

      expect(sessionEventService.getAllSessionEvents).toHaveBeenCalledWith(
        visibilityType,
        searchName,
        {
          limit: undefined,
          offset: undefined,
          sortBy: SessionEventSortBy.CREATED_AT,
          order: SortOrder.DESC,
        },
        mockUser.id,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('deleteSessionEvents', () => {
    it('should delete session events and return true', async () => {
      const deleteDto = {
        eventIds: ['event-1', 'event-2', 'event-3'],
      };
      sessionEventService.deleteSessionEvents.mockResolvedValue(true);

      const result = await controller.deleteSessionEvents(deleteDto);

      expect(sessionEventService.deleteSessionEvents).toHaveBeenCalledWith(
        deleteDto.eventIds,
      );
      expect(result).toBe(true);
    });

    it('should return false when no events are deleted', async () => {
      const deleteDto = {
        eventIds: ['non-existent-id'],
      };
      sessionEventService.deleteSessionEvents.mockResolvedValue(false);

      const result = await controller.deleteSessionEvents(deleteDto);

      expect(sessionEventService.deleteSessionEvents).toHaveBeenCalledWith(
        deleteDto.eventIds,
      );
      expect(result).toBe(false);
    });

    it('should handle single event deletion', async () => {
      const deleteDto = {
        eventIds: ['event-1'],
      };
      sessionEventService.deleteSessionEvents.mockResolvedValue(true);

      const result = await controller.deleteSessionEvents(deleteDto);

      expect(sessionEventService.deleteSessionEvents).toHaveBeenCalledWith(
        deleteDto.eventIds,
      );
      expect(result).toBe(true);
    });

    it('should handle empty event ids array', async () => {
      const deleteDto = {
        eventIds: [],
      };
      sessionEventService.deleteSessionEvents.mockResolvedValue(false);

      const result = await controller.deleteSessionEvents(deleteDto);

      expect(sessionEventService.deleteSessionEvents).toHaveBeenCalledWith(
        deleteDto.eventIds,
      );
      expect(result).toBe(false);
    });

    it('should handle service error during deletion', async () => {
      const deleteDto = {
        eventIds: ['event-1', 'event-2'],
      };
      const error = new Error('Deletion failed');
      sessionEventService.deleteSessionEvents.mockRejectedValue(error);

      await expect(controller.deleteSessionEvents(deleteDto)).rejects.toThrow(
        'Deletion failed',
      );
      expect(sessionEventService.deleteSessionEvents).toHaveBeenCalledWith(
        deleteDto.eventIds,
      );
    });
  });

  describe('translatePassiveSessionEvents', () => {
    it('should translate passive session events and return success', async () => {
      sessionEventService.translatePassiveSessionEvents.mockResolvedValue({
        success: true,
      });

      const result = await controller.translatePassiveSessionEvents();

      expect(
        sessionEventService.translatePassiveSessionEvents,
      ).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should handle service error during translation', async () => {
      const error = new Error('Translation failed');
      sessionEventService.translatePassiveSessionEvents.mockRejectedValue(
        error,
      );

      await expect(controller.translatePassiveSessionEvents()).rejects.toThrow(
        'Translation failed',
      );
      expect(
        sessionEventService.translatePassiveSessionEvents,
      ).toHaveBeenCalled();
    });
  });

  describe('getUniqueTags', () => {
    it('should get all unique tags without search filter', async () => {
      const mockTags = ['tag1', 'tag2', 'tag3'];
      sessionEventService.getUniqueTags = jest.fn().mockResolvedValue(mockTags);

      const result = await controller.getUniqueTags();

      expect(sessionEventService.getUniqueTags).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ data: mockTags });
    });

    it('should get unique tags with search filter', async () => {
      const mockTags = ['important', 'important-event'];
      const searchFilter = 'important';
      sessionEventService.getUniqueTags = jest.fn().mockResolvedValue(mockTags);

      const result = await controller.getUniqueTags(searchFilter);

      expect(sessionEventService.getUniqueTags).toHaveBeenCalledWith(
        searchFilter,
      );
      expect(result).toEqual({ data: mockTags });
    });

    it('should return empty array when no tags found', async () => {
      const mockTags: string[] = [];
      sessionEventService.getUniqueTags = jest.fn().mockResolvedValue(mockTags);

      const result = await controller.getUniqueTags();

      expect(sessionEventService.getUniqueTags).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ data: [] });
    });

    it('should handle empty search string', async () => {
      const mockTags = ['tag1', 'tag2'];
      sessionEventService.getUniqueTags = jest.fn().mockResolvedValue(mockTags);

      const result = await controller.getUniqueTags('');

      expect(sessionEventService.getUniqueTags).toHaveBeenCalledWith('');
      expect(result).toEqual({ data: mockTags });
    });

    it('should handle search with special characters', async () => {
      const mockTags = ['test-tag'];
      const searchFilter = 'test-tag';
      sessionEventService.getUniqueTags = jest.fn().mockResolvedValue(mockTags);

      const result = await controller.getUniqueTags(searchFilter);

      expect(sessionEventService.getUniqueTags).toHaveBeenCalledWith(
        searchFilter,
      );
      expect(result).toEqual({ data: mockTags });
    });

    it('should handle service error', async () => {
      const error = new Error('Database error');
      sessionEventService.getUniqueTags = jest.fn().mockRejectedValue(error);

      await expect(controller.getUniqueTags()).rejects.toThrow(
        'Database error',
      );
      expect(sessionEventService.getUniqueTags).toHaveBeenCalledWith(undefined);
    });

    it('should get tags with case-insensitive search', async () => {
      const mockTags = ['Test', 'Testing'];
      const searchFilter = 'test';
      sessionEventService.getUniqueTags = jest.fn().mockResolvedValue(mockTags);

      const result = await controller.getUniqueTags(searchFilter);

      expect(sessionEventService.getUniqueTags).toHaveBeenCalledWith(
        searchFilter,
      );
      expect(result).toEqual({ data: mockTags });
    });

    it('should return tags in alphabetical order', async () => {
      const mockTags = ['apple', 'banana', 'cherry'];
      sessionEventService.getUniqueTags = jest.fn().mockResolvedValue(mockTags);

      const result = await controller.getUniqueTags();

      expect(result).toEqual({ data: mockTags });
      expect(result.data).toEqual(['apple', 'banana', 'cherry']);
    });
  });
});
