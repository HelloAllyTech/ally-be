import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SessionEventService } from '../session-event.service';
import { SessionEvents } from '../../entity/session-events.entity';
import { CreateSessionEventDto } from '../../dto/create-session-event.dto';
import { UpdateSessionEventDto } from '../../dto/update-session-event.dto';
import { SessionEventDetectionType } from 'src/session-event/enum/session-event-detection-type.enum';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';
import { SessionEventRepository } from '../../repository/session-event.repository';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';

describe('SessionEventService', () => {
  let service: SessionEventService;
  let repository: jest.Mocked<SessionEventRepository>;

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

  const mockUpdateSessionEventDto: UpdateSessionEventDto = {
    name: 'Updated Event',
    description: 'Updated description',
    score: 90,
    emoji: '🎉',
    message: 'Excellent work!',
    branchInstruction: 'Move to advanced level',
  };

  const mockQueryBuilder = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  beforeEach(async () => {
    const mockRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      getAllSessionEvents: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionEventService,
        {
          provide: SessionEventRepository,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<SessionEventService>(SessionEventService);
    repository = module.get(SessionEventRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSessionEvents', () => {
    it('should create session events successfully', async () => {
      const createEventDtos = [mockCreateSessionEventDto];
      const createdEvents = [mockSessionEvent];

      repository.save.mockResolvedValue(createdEvents as any);

      const result = await service.createSessionEvents(createEventDtos);

      expect(repository.save).toHaveBeenCalledWith(createEventDtos);
      expect(result).toEqual(createdEvents);
    });

    it('should create multiple session events successfully', async () => {
      const createEventDtos = [
        mockCreateSessionEventDto,
        {
          ...mockCreateSessionEventDto,
          id: 'event-2',
          name: 'Second Event',
        },
      ];
      const createdEvents = [
        mockSessionEvent,
        { ...mockSessionEvent, id: 'event-2', name: 'Second Event' },
      ];

      repository.save.mockResolvedValue(createdEvents as any);

      const result = await service.createSessionEvents(createEventDtos);

      expect(repository.save).toHaveBeenCalledWith(createEventDtos);
      expect(result).toEqual(createdEvents);
    });

    it('should handle empty array input', async () => {
      const createEventDtos: CreateSessionEventDto[] = [];
      const createdEvents: SessionEvents[] = [];

      repository.save.mockResolvedValue(createdEvents as any);

      const result = await service.createSessionEvents(createEventDtos);

      expect(repository.save).toHaveBeenCalledWith(createEventDtos);
      expect(result).toEqual(createdEvents);
    });

    it('should handle repository save error', async () => {
      const createEventDtos = [mockCreateSessionEventDto];
      const error = new Error('Save failed');

      repository.save.mockRejectedValue(error);

      await expect(
        service.createSessionEvents(createEventDtos),
      ).rejects.toThrow('Save failed');
      expect(repository.save).toHaveBeenCalledWith(createEventDtos);
    });

    it('should handle null input gracefully', async () => {
      const createEventDtos = null as any;
      const error = new Error('Invalid input');

      repository.save.mockRejectedValue(error);

      await expect(
        service.createSessionEvents(createEventDtos),
      ).rejects.toThrow('Invalid input');
      expect(repository.save).toHaveBeenCalledWith(createEventDtos);
    });

    it('should handle undefined input gracefully', async () => {
      const createEventDtos = undefined as any;
      const error = new Error('Invalid input');

      repository.save.mockRejectedValue(error);

      await expect(
        service.createSessionEvents(createEventDtos),
      ).rejects.toThrow('Invalid input');
      expect(repository.save).toHaveBeenCalledWith(createEventDtos);
    });

    it('should handle single event with minimal data', async () => {
      const minimalEventDto = {
        id: 'minimal-event',
        name: 'Minimal Event',
        detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
        visibilityType: SessionEventVisibilityType.ACTIVE,
      };
      const createdEvent = {
        ...minimalEventDto,
        description: null,
        score: null,
        emoji: null,
        message: null,
        branchInstruction: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      repository.save.mockResolvedValue([createdEvent] as any);

      const result = await service.createSessionEvents([minimalEventDto]);

      expect(repository.save).toHaveBeenCalledWith([minimalEventDto]);
      expect(result).toEqual([createdEvent]);
    });
  });

  describe('getSessionEventsByScenarioId', () => {
    it('should get session events by scenario ID successfully', async () => {
      const scenarioId = 123;
      const expectedEvents = [mockSessionEvent];

      mockQueryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await service.getSessionEventsByScenarioId(scenarioId);

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvents',
      );
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        ScenarioEvents, // ScenarioEvents class
        'scenarioEvents',
        'scenarioEvents.eventId = sessionEvents.id',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `(scenarioEvents.scenarioId = :scenarioId AND sessionEvents.visibilityType = '${SessionEventVisibilityType.ACTIVE}') `,
        { scenarioId: scenarioId },
      );
      expect(mockQueryBuilder.orWhere).toHaveBeenCalledWith(
        `sessionEvents.visibilityType = '${SessionEventVisibilityType.PASSIVE}'`,
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should return empty array when no events found for scenario', async () => {
      const scenarioId = 999;
      const expectedEvents: SessionEvents[] = [];

      mockQueryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await service.getSessionEventsByScenarioId(scenarioId);

      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvents',
      );
      expect(mockQueryBuilder.leftJoin).toHaveBeenCalledWith(
        ScenarioEvents,
        'scenarioEvents',
        'scenarioEvents.eventId = sessionEvents.id',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `(scenarioEvents.scenarioId = :scenarioId AND sessionEvents.visibilityType = '${SessionEventVisibilityType.ACTIVE}') `,
        { scenarioId: scenarioId },
      );
      expect(mockQueryBuilder.orWhere).toHaveBeenCalledWith(
        `sessionEvents.visibilityType = '${SessionEventVisibilityType.PASSIVE}'`,
      );
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
      expect(result).toEqual(expectedEvents);
    });

    it('should handle zero scenario ID', async () => {
      const scenarioId = 0;
      const expectedEvents = [mockSessionEvent];

      mockQueryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await service.getSessionEventsByScenarioId(scenarioId);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `(scenarioEvents.scenarioId = :scenarioId AND sessionEvents.visibilityType = '${SessionEventVisibilityType.ACTIVE}') `,
        { scenarioId: 0 },
      );
      expect(result).toEqual(expectedEvents);
    });

    it('should handle negative scenario ID', async () => {
      const scenarioId = -1;
      const expectedEvents: SessionEvents[] = [];

      mockQueryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await service.getSessionEventsByScenarioId(scenarioId);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `(scenarioEvents.scenarioId = :scenarioId AND sessionEvents.visibilityType = '${SessionEventVisibilityType.ACTIVE}') `,
        { scenarioId: -1 },
      );
      expect(result).toEqual(expectedEvents);
    });

    it('should handle query builder error', async () => {
      const scenarioId = 123;
      const error = new Error('Query failed');

      mockQueryBuilder.getMany.mockRejectedValue(error);

      await expect(
        service.getSessionEventsByScenarioId(scenarioId),
      ).rejects.toThrow('Query failed');
      expect(repository.createQueryBuilder).toHaveBeenCalledWith(
        'sessionEvents',
      );
    });

    it('should handle very large scenario ID', async () => {
      const scenarioId = Number.MAX_SAFE_INTEGER;
      const expectedEvents = [mockSessionEvent];

      mockQueryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await service.getSessionEventsByScenarioId(scenarioId);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `(scenarioEvents.scenarioId = :scenarioId AND sessionEvents.visibilityType = '${SessionEventVisibilityType.ACTIVE}') `,
        { scenarioId: Number.MAX_SAFE_INTEGER },
      );
      expect(result).toEqual(expectedEvents);
    });

    it('should handle decimal scenario ID by converting to integer', async () => {
      const scenarioId = 123.45;
      const expectedEvents = [mockSessionEvent];

      mockQueryBuilder.getMany.mockResolvedValue(expectedEvents);

      const result = await service.getSessionEventsByScenarioId(scenarioId);

      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        `(scenarioEvents.scenarioId = :scenarioId AND sessionEvents.visibilityType = '${SessionEventVisibilityType.ACTIVE}') `,
        { scenarioId: 123.45 },
      );
      expect(result).toEqual(expectedEvents);
    });
  });

  describe('updateSessionEvent', () => {
    const eventId = 'event-1';

    it('should update session event successfully', async () => {
      repository.findOne.mockResolvedValue(mockSessionEvent);
      repository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.updateSessionEvent(
        eventId,
        mockUpdateSessionEventDto,
      );

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: eventId },
      });
      expect(repository.update).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
      );
      expect(result).toBe(true);
    });

    it('should return false when update affects no rows', async () => {
      repository.findOne.mockResolvedValue(mockSessionEvent);
      repository.update.mockResolvedValue({ affected: 0 } as any);

      const result = await service.updateSessionEvent(
        eventId,
        mockUpdateSessionEventDto,
      );

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: eventId },
      });
      expect(repository.update).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
      );
      expect(result).toBe(false);
    });

    it('should handle undefined affected value', async () => {
      repository.findOne.mockResolvedValue(mockSessionEvent);
      repository.update.mockResolvedValue({ affected: undefined } as any);

      const result = await service.updateSessionEvent(
        eventId,
        mockUpdateSessionEventDto,
      );

      expect(result).toBe(true); // undefined !== 0 is true
    });

    it('should throw NotFoundException when session event not found', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.updateSessionEvent(eventId, mockUpdateSessionEventDto),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.updateSessionEvent(eventId, mockUpdateSessionEventDto),
      ).rejects.toThrow('Session Event not found');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: eventId },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should update with partial data', async () => {
      const partialUpdate: UpdateSessionEventDto = {
        name: 'Partially Updated Event',
        score: 95,
      };

      repository.findOne.mockResolvedValue(mockSessionEvent);
      repository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.updateSessionEvent(eventId, partialUpdate);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: eventId },
      });
      expect(repository.update).toHaveBeenCalledWith(eventId, partialUpdate);
      expect(result).toBe(true);
    });

    it('should update with empty object', async () => {
      const emptyUpdate: UpdateSessionEventDto = {};

      repository.findOne.mockResolvedValue(mockSessionEvent);
      repository.update.mockResolvedValue({ affected: 1 } as any);

      const result = await service.updateSessionEvent(eventId, emptyUpdate);

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: eventId },
      });
      expect(repository.update).toHaveBeenCalledWith(eventId, emptyUpdate);
      expect(result).toBe(true);
    });

    it('should handle repository findOne error', async () => {
      const error = new Error('Database connection failed');
      repository.findOne.mockRejectedValue(error);

      await expect(
        service.updateSessionEvent(eventId, mockUpdateSessionEventDto),
      ).rejects.toThrow('Database connection failed');
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: eventId },
      });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('should handle repository update error', async () => {
      const error = new Error('Update operation failed');
      repository.findOne.mockResolvedValue(mockSessionEvent);
      repository.update.mockRejectedValue(error);

      await expect(
        service.updateSessionEvent(eventId, mockUpdateSessionEventDto),
      ).rejects.toThrow('Update operation failed');
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: eventId },
      });
      expect(repository.update).toHaveBeenCalledWith(
        eventId,
        mockUpdateSessionEventDto,
      );
    });

    it('should handle null affected value', async () => {
      repository.findOne.mockResolvedValue(mockSessionEvent);
      repository.update.mockResolvedValue({ affected: null } as any);

      const result = await service.updateSessionEvent(
        eventId,
        mockUpdateSessionEventDto,
      );

      expect(result).toBe(true); // null !== 0 is true
    });

    it('should handle negative affected value', async () => {
      repository.findOne.mockResolvedValue(mockSessionEvent);
      repository.update.mockResolvedValue({ affected: -1 } as any);

      const result = await service.updateSessionEvent(
        eventId,
        mockUpdateSessionEventDto,
      );

      expect(result).toBe(true); // -1 !== 0 is true
    });
  });

  describe('findByIds', () => {
    it('should find session events by IDs successfully', async () => {
      const ids = ['event-1', 'event-2'];
      const expectedEvents = [
        mockSessionEvent,
        { ...mockSessionEvent, id: 'event-2', name: 'Second Event' },
      ];

      repository.find.mockResolvedValue(expectedEvents);

      const result = await service.findByIds(ids);

      expect(repository.find).toHaveBeenCalledWith({
        where: { id: expect.objectContaining({ _type: 'in', _value: ids }) },
      });
      expect(result).toEqual(expectedEvents);
    });

    it('should return empty array when no IDs provided', async () => {
      const ids: string[] = [];

      const result = await service.findByIds(ids);

      expect(repository.find).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should return empty array when IDs array is null', async () => {
      const result = await service.findByIds(null as any);

      expect(repository.find).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should return empty array when IDs array is undefined', async () => {
      const result = await service.findByIds(undefined as any);

      expect(repository.find).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should handle single ID in array', async () => {
      const ids = ['event-1'];
      const expectedEvents = [mockSessionEvent];

      repository.find.mockResolvedValue(expectedEvents);

      const result = await service.findByIds(ids);

      expect(repository.find).toHaveBeenCalledWith({
        where: { id: expect.objectContaining({ _type: 'in', _value: ids }) },
      });
      expect(result).toEqual(expectedEvents);
    });

    it('should handle duplicate IDs in array', async () => {
      const ids = ['event-1', 'event-1', 'event-2'];
      const expectedEvents = [
        mockSessionEvent,
        { ...mockSessionEvent, id: 'event-2', name: 'Second Event' },
      ];

      repository.find.mockResolvedValue(expectedEvents);

      const result = await service.findByIds(ids);

      expect(repository.find).toHaveBeenCalledWith({
        where: { id: expect.objectContaining({ _type: 'in', _value: ids }) },
      });
      expect(result).toEqual(expectedEvents);
    });

    it('should return empty array when no events found for given IDs', async () => {
      const ids = ['non-existent-1', 'non-existent-2'];
      const expectedEvents: SessionEvents[] = [];

      repository.find.mockResolvedValue(expectedEvents);

      const result = await service.findByIds(ids);

      expect(repository.find).toHaveBeenCalledWith({
        where: { id: expect.objectContaining({ _type: 'in', _value: ids }) },
      });
      expect(result).toEqual(expectedEvents);
    });

    it('should handle partial matches for IDs', async () => {
      const ids = ['event-1', 'non-existent'];
      const expectedEvents = [mockSessionEvent]; // Only event-1 found

      repository.find.mockResolvedValue(expectedEvents);

      const result = await service.findByIds(ids);

      expect(repository.find).toHaveBeenCalledWith({
        where: { id: expect.objectContaining({ _type: 'in', _value: ids }) },
      });
      expect(result).toEqual(expectedEvents);
    });

    it('should handle repository find error', async () => {
      const ids = ['event-1', 'event-2'];
      const error = new Error('Database query failed');

      repository.find.mockRejectedValue(error);

      await expect(service.findByIds(ids)).rejects.toThrow(
        'Database query failed',
      );
      expect(repository.find).toHaveBeenCalledWith({
        where: { id: expect.objectContaining({ _type: 'in', _value: ids }) },
      });
    });

    it('should handle large array of IDs', async () => {
      const ids = Array.from({ length: 100 }, (_, i) => `event-${i + 1}`);
      const expectedEvents = ids.map((id, index) => ({
        ...mockSessionEvent,
        id,
        name: `Event ${index + 1}`,
      }));

      repository.find.mockResolvedValue(expectedEvents);

      const result = await service.findByIds(ids);

      expect(repository.find).toHaveBeenCalledWith({
        where: { id: expect.objectContaining({ _type: 'in', _value: ids }) },
      });
      expect(result).toEqual(expectedEvents);
    });
  });

  describe('getAllSessionEvents', () => {
    it('should get all session events without filters', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents();

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should get session events with visibility type filter', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };
      const visibilityType = SessionEventVisibilityType.ACTIVE;

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents(visibilityType);

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        visibilityType,
        undefined,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should get session events with pagination', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };
      const pagination = {
        limit: 10,
        offset: 0,
        sortBy: 'createdAt',
        order: 'DESC' as any,
      };

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents(undefined, pagination);

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        pagination,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should get session events with both visibility type and pagination', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };
      const visibilityType = SessionEventVisibilityType.PASSIVE;
      const pagination = {
        limit: 5,
        offset: 10,
        sortBy: 'name',
        order: 'ASC' as any,
      };

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents(
        visibilityType,
        pagination,
      );

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        visibilityType,
        pagination,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should return empty array when no events found', async () => {
      const expectedEvents: SessionEvents[] = [];
      const expectedResult = { data: expectedEvents };

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents();

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle repository error', async () => {
      const error = new Error('Database query failed');
      repository.getAllSessionEvents.mockRejectedValue(error);

      await expect(service.getAllSessionEvents()).rejects.toThrow(
        'Database query failed',
      );
      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        undefined,
      );
    });

    it('should handle pagination with zero limit', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };
      const pagination = {
        limit: 0,
        offset: 0,
        sortBy: 'createdAt',
        order: 'DESC' as any,
      };

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents(undefined, pagination);

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        pagination,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle pagination with negative offset', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };
      const pagination = {
        limit: 10,
        offset: -5,
        sortBy: 'name',
        order: 'ASC' as any,
      };

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents(undefined, pagination);

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        pagination,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle pagination with very large limit', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };
      const pagination = {
        limit: Number.MAX_SAFE_INTEGER,
        offset: 0,
        sortBy: 'createdAt',
        order: 'DESC' as any,
      };

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents(undefined, pagination);

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        pagination,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should handle pagination with invalid sortBy', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };
      const pagination = {
        limit: 10,
        offset: 0,
        sortBy: 'invalidField',
        order: 'DESC' as any,
      };

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents(undefined, pagination);

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        pagination,
      );
      expect(result).toEqual(expectedResult);
    });
  });
});
