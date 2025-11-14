import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SessionEventService } from '../session-event.service';
import { SessionEvents } from '../../entity/session-events.entity';
import { CreateSessionEventDto } from '../../dto/create-session-event.dto';
import { UpdateSessionEventDto } from '../../dto/update-session-event.dto';
import { SessionEventDetectionType } from 'src/session-event/enum/session-event-detection-type.enum';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';
import { SessionEventRepository } from '../../repository/session-event.repository';
import { ScenarioEvents } from 'src/learn/entity/scenario-events.entity';
import { SessionEventSpeaker } from 'src/session-event/enum/session-event-speaker.enum';

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
    speaker: SessionEventSpeaker.CARE_GIVER,
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
    sentences: ['Sentence 1', 'Sentence 2', 'Sentence 3'],
    speaker: SessionEventSpeaker.CARE_GIVER,
  };

  const mockUpdateSessionEventDto: UpdateSessionEventDto = {
    name: 'Updated Event',
    description: 'Updated description',
    score: 90,
    emoji: '🎉',
    message: 'Excellent work!',
    branchInstruction: 'Move to advanced level',
    speaker: SessionEventSpeaker.CARE_GIVER,
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
      getSessionEventsByScenarioId: jest.fn(),
    };

    const mockEntityManager = {
      getRepository: jest.fn().mockReturnValue({
        softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      }),
    };

    const mockDataSource = {
      createEntityManager: jest.fn(),
      transaction: jest.fn((callback) => callback(mockEntityManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionEventService,
        {
          provide: SessionEventRepository,
          useValue: mockRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
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

      expect(repository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            ...mockCreateSessionEventDto,
          }),
        ]),
      );
      expect(result).toEqual(createdEvents);
    });

    it('should create multiple session events successfully', async () => {
      const createEventDtos = [
        mockCreateSessionEventDto,
        {
          ...mockCreateSessionEventDto,
          name: 'Second Event',
        },
      ];
      const createdEvents = [
        mockSessionEvent,
        { ...mockSessionEvent, id: 'event-2', name: 'Second Event' },
      ];

      repository.save.mockResolvedValue(createdEvents as any);

      const result = await service.createSessionEvents(createEventDtos);

      expect(repository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            ...mockCreateSessionEventDto,
          }),
          expect.objectContaining({
            id: expect.any(String),
            ...mockCreateSessionEventDto,
            name: 'Second Event',
          }),
        ]),
      );
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
      expect(repository.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            ...mockCreateSessionEventDto,
          }),
        ]),
      );
    });

    it('should handle null input gracefully', async () => {
      const createEventDtos = null as any;

      await expect(
        service.createSessionEvents(createEventDtos),
      ).rejects.toThrow("Cannot read properties of null (reading 'map')");
    });

    it('should handle undefined input gracefully', async () => {
      const createEventDtos = undefined as any;

      await expect(
        service.createSessionEvents(createEventDtos),
      ).rejects.toThrow("Cannot read properties of undefined (reading 'map')");
    });

    it('should handle single event with minimal data', async () => {
      const minimalEventDto = {
        id: 'minimal-event',
        name: 'Minimal Event',
        detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
        visibilityType: SessionEventVisibilityType.ACTIVE,
        speaker: SessionEventSpeaker.CARE_GIVER,
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
        undefined,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should get session events with searchName filter', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };
      const searchName = 'Test';

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents(
        undefined,
        searchName,
        undefined,
      );

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        searchName,
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

      const result = await service.getAllSessionEvents(
        undefined,
        undefined,
        pagination,
      );

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        undefined,
        pagination,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should get session events with visibility type and searchName', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };
      const visibilityType = SessionEventVisibilityType.ACTIVE;
      const searchName = 'Event';

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents(
        visibilityType,
        searchName,
        undefined,
      );

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        visibilityType,
        searchName,
        undefined,
      );
      expect(result).toEqual(expectedResult);
    });

    it('should get session events with all parameters', async () => {
      const expectedEvents = [mockSessionEvent];
      const expectedResult = { data: expectedEvents };
      const visibilityType = SessionEventVisibilityType.PASSIVE;
      const searchName = 'Test Event';
      const pagination = {
        limit: 5,
        offset: 10,
        sortBy: 'name',
        order: 'ASC' as any,
      };

      repository.getAllSessionEvents.mockResolvedValue(expectedEvents);

      const result = await service.getAllSessionEvents(
        visibilityType,
        searchName,
        pagination,
      );

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        visibilityType,
        searchName,
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

      const result = await service.getAllSessionEvents(
        undefined,
        undefined,
        pagination,
      );

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
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

      const result = await service.getAllSessionEvents(
        undefined,
        undefined,
        pagination,
      );

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
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

      const result = await service.getAllSessionEvents(
        undefined,
        undefined,
        pagination,
      );

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
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

      const result = await service.getAllSessionEvents(
        undefined,
        undefined,
        pagination,
      );

      expect(repository.getAllSessionEvents).toHaveBeenCalledWith(
        undefined,
        undefined,
        pagination,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('deleteSessionEvents', () => {
    let mockSoftDelete: jest.Mock;
    let mockGetRepository: jest.Mock;
    let mockTransaction: jest.Mock;

    beforeEach(() => {
      mockSoftDelete = jest.fn().mockResolvedValue({ affected: 1 });
      mockGetRepository = jest.fn().mockReturnValue({
        softDelete: mockSoftDelete,
      });

      const serviceDataSource = (service as any).dataSource;
      mockTransaction = serviceDataSource.transaction as jest.Mock;
      mockTransaction.mockImplementation(async (callback) => {
        const mockEntityManager = {
          getRepository: mockGetRepository,
        };
        return await callback(mockEntityManager);
      });
    });

    it('should delete session events and return true when affected > 0', async () => {
      const eventIds = ['event-1', 'event-2', 'event-3'];
      const activeEvents = [
        { id: 'event-1' },
        { id: 'event-2' },
        { id: 'event-3' },
      ];

      repository.find.mockResolvedValue(activeEvents as any);

      const result = await service.deleteSessionEvents(eventIds);

      expect(repository.find).toHaveBeenCalledWith({
        select: ['id'],
        where: {
          id: expect.any(Object),
          visibilityType: SessionEventVisibilityType.ACTIVE,
        },
      });
      expect(mockTransaction).toHaveBeenCalled();
      expect(mockGetRepository).toHaveBeenCalledWith(SessionEvents);
      expect(mockGetRepository).toHaveBeenCalledWith(ScenarioEvents);
      expect(mockSoftDelete).toHaveBeenCalledWith({
        id: expect.any(Object),
      });
      expect(mockSoftDelete).toHaveBeenCalledWith({
        eventId: expect.any(Object),
      });
      expect(result).toBe(true);
    });

    it('should return true when no events affected', async () => {
      const eventIds = ['event-1'];
      const activeEvents = [{ id: 'event-1' }];

      repository.find.mockResolvedValue(activeEvents as any);
      mockSoftDelete.mockResolvedValue({ affected: 0 });

      const result = await service.deleteSessionEvents(eventIds);

      expect(mockTransaction).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should handle single event id deletion', async () => {
      const eventIds = ['event-1'];
      const activeEvents = [{ id: 'event-1' }];

      repository.find.mockResolvedValue(activeEvents as any);

      const result = await service.deleteSessionEvents(eventIds);

      expect(mockTransaction).toHaveBeenCalled();
      expect(mockSoftDelete).toHaveBeenCalledWith({
        id: expect.any(Object),
      });
      expect(result).toBe(true);
    });

    it('should throw BadRequestException when empty event ids array', async () => {
      const eventIds: string[] = [];

      repository.find.mockResolvedValue([]);

      await expect(service.deleteSessionEvents(eventIds)).rejects.toThrow(
        'No active events found to delete',
      );
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('should handle database error during deletion', async () => {
      const eventIds = ['event-1', 'event-2'];
      const activeEvents = [{ id: 'event-1' }, { id: 'event-2' }];
      const error = new Error('Database deletion failed');

      repository.find.mockResolvedValue(activeEvents as any);
      mockSoftDelete.mockRejectedValue(error);

      await expect(service.deleteSessionEvents(eventIds)).rejects.toThrow(
        'Database deletion failed',
      );
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('should only delete ACTIVE events, not PASSIVE events', async () => {
      const eventIds = ['event-1', 'event-2', 'event-3'];
      const activeEvents = [{ id: 'event-1' }, { id: 'event-2' }]; // Only 2 active

      repository.find.mockResolvedValue(activeEvents as any);

      const result = await service.deleteSessionEvents(eventIds);

      expect(repository.find).toHaveBeenCalledWith({
        select: ['id'],
        where: {
          id: expect.any(Object),
          visibilityType: SessionEventVisibilityType.ACTIVE,
        },
      });
      expect(mockTransaction).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should throw BadRequestException when no ACTIVE events found', async () => {
      const eventIds = ['event-1', 'event-2'];

      repository.find.mockResolvedValue([]);

      await expect(service.deleteSessionEvents(eventIds)).rejects.toThrow(
        'No active events found to delete',
      );
      expect(repository.find).toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  describe('getSessionEventsByScenarioId', () => {
    const mockScenarioId = 1;

    it('should return session events for a scenario with feedbackStatus true', async () => {
      const mockRawEvents = [
        {
          sessionEvents_id: 'event-1',
          sessionEvents_name: 'Event 1',
          sessionEvents_description: 'Description 1',
          sessionEvents_score: 80,
          sessionEvents_emoji: '🎯',
          sessionEvents_message: 'Default message',
          sessionEvents_branchInstruction: 'Default branch',
          sessionEvents_detectionType:
            SessionEventDetectionType.SENTENCE_SIMILARITY,
          sessionEvents_visibilityType: SessionEventVisibilityType.ACTIVE,
          sessionEvents_sentences: ['Sentence 1', 'Sentence 2'],
          sessionEvents_speaker: SessionEventSpeaker.CARE_GIVER,
          sessionEvents_createdAt: new Date('2024-01-01T10:00:00Z'),
          sessionEvents_updatedAt: new Date('2024-01-01T10:00:00Z'),
          scenarioEvents_feedbackStatus: true,
          scenarioEvents_score: 90,
          scenarioEvents_emoji: '🎉',
          scenarioEvents_message: 'Custom message',
          scenarioEvents_branchingStatus: true,
          scenarioEvents_branchInstruction: 'Custom branch',
        },
      ];

      repository.getSessionEventsByScenarioId.mockResolvedValue(
        mockRawEvents as any,
      );

      const result = await service.getSessionEventsByScenarioId(mockScenarioId);

      expect(result).toEqual([
        {
          id: 'event-1',
          name: 'Event 1',
          description: 'Description 1',
          score: 90,
          emoji: '🎉',
          message: 'Custom message',
          branchInstruction: 'Custom branch',
          detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
          visibilityType: SessionEventVisibilityType.ACTIVE,
          feedbackStatus: true,
          sentences: ['Sentence 1', 'Sentence 2'],
          speaker: SessionEventSpeaker.CARE_GIVER,
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
      ]);
      expect(repository.getSessionEventsByScenarioId).toHaveBeenCalledWith(
        mockScenarioId,
      );
    });

    it('should return session events with default values when feedbackStatus false', async () => {
      const mockRawEvents = [
        {
          sessionEvents_id: 'event-2',
          sessionEvents_name: 'Event 2',
          sessionEvents_description: 'Description 2',
          sessionEvents_score: 75,
          sessionEvents_emoji: '✅',
          sessionEvents_message: 'Default message 2',
          sessionEvents_branchInstruction: 'Default branch 2',
          sessionEvents_detectionType:
            SessionEventDetectionType.SENTENCE_SIMILARITY,
          sessionEvents_visibilityType: SessionEventVisibilityType.PASSIVE,
          sessionEvents_sentences: ['Sentence A', 'Sentence B'],
          sessionEvents_speaker: SessionEventSpeaker.CARE_GIVER,
          sessionEvents_createdAt: new Date('2024-01-02T10:00:00Z'),
          sessionEvents_updatedAt: new Date('2024-01-02T10:00:00Z'),
          scenarioEvents_feedbackStatus: false,
          scenarioEvents_score: 85,
          scenarioEvents_emoji: '🚀',
          scenarioEvents_message: 'Custom message 2',
          scenarioEvents_branchingStatus: false,
          scenarioEvents_branchInstruction: 'Custom branch 2',
        },
      ];

      repository.getSessionEventsByScenarioId.mockResolvedValue(
        mockRawEvents as any,
      );

      const result = await service.getSessionEventsByScenarioId(mockScenarioId);

      expect(result).toEqual([
        {
          id: 'event-2',
          name: 'Event 2',
          description: 'Description 2',
          score: 85, // Uses scenarioEvents_score via ?? operator
          emoji: '✅',
          message: 'Default message 2',
          branchInstruction: null, // null when scenarioEvents_branchingStatus is false
          detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
          visibilityType: SessionEventVisibilityType.PASSIVE,
          feedbackStatus: false,
          sentences: ['Sentence A', 'Sentence B'],
          speaker: SessionEventSpeaker.CARE_GIVER,
          createdAt: new Date('2024-01-02T10:00:00Z'),
          updatedAt: new Date('2024-01-02T10:00:00Z'),
        },
      ]);
    });

    it('should return empty array when no events found', async () => {
      repository.getSessionEventsByScenarioId.mockResolvedValue([]);

      const result = await service.getSessionEventsByScenarioId(mockScenarioId);

      expect(result).toEqual([]);
      expect(repository.getSessionEventsByScenarioId).toHaveBeenCalledWith(
        mockScenarioId,
      );
    });

    it('should handle multiple events with mixed feedbackStatus', async () => {
      const mockRawEvents = [
        {
          sessionEvents_id: 'event-1',
          sessionEvents_name: 'Event 1',
          sessionEvents_description: 'Description 1',
          sessionEvents_score: 80,
          sessionEvents_emoji: '🎯',
          sessionEvents_message: 'Default 1',
          sessionEvents_branchInstruction: 'Default branch 1',
          scenarioEvents_feedbackStatus: true,
          scenarioEvents_score: 90,
          scenarioEvents_emoji: '🎉',
          scenarioEvents_message: 'Custom 1',
          scenarioEvents_branchingStatus: true,
          scenarioEvents_branchInstruction: 'Custom branch 1',
        },
        {
          sessionEvents_id: 'event-2',
          sessionEvents_name: 'Event 2',
          sessionEvents_description: 'Description 2',
          sessionEvents_score: 70,
          sessionEvents_emoji: '✅',
          sessionEvents_message: 'Default 2',
          sessionEvents_branchInstruction: 'Default branch 2',
          scenarioEvents_feedbackStatus: false,
          scenarioEvents_score: null,
          scenarioEvents_emoji: null,
          scenarioEvents_message: null,
          scenarioEvents_branchingStatus: false,
          scenarioEvents_branchInstruction: null,
        },
      ];

      repository.getSessionEventsByScenarioId.mockResolvedValue(
        mockRawEvents as any,
      );

      const result = await service.getSessionEventsByScenarioId(mockScenarioId);

      expect(result).toHaveLength(2);
      expect(result[0].score).toBe(90); // Custom score
      expect(result[1].score).toBe(70); // Default score
    });

    it('should handle repository errors', async () => {
      const error = new Error('Repository error');
      repository.getSessionEventsByScenarioId.mockRejectedValue(error);

      await expect(
        service.getSessionEventsByScenarioId(mockScenarioId),
      ).rejects.toThrow('Repository error');
    });

    it('should handle null/undefined values in raw events', async () => {
      const mockRawEvents = [
        {
          sessionEvents_id: 'event-3',
          sessionEvents_name: null,
          sessionEvents_description: null,
          sessionEvents_score: null,
          sessionEvents_emoji: null,
          sessionEvents_message: null,
          sessionEvents_branchInstruction: null,
          sessionEvents_detectionType: undefined,
          sessionEvents_visibilityType: undefined,
          sessionEvents_sentences: undefined,
          sessionEvents_speaker: undefined,
          sessionEvents_createdAt: undefined,
          sessionEvents_updatedAt: undefined,
          scenarioEvents_feedbackStatus: false,
          scenarioEvents_score: null,
          scenarioEvents_emoji: null,
          scenarioEvents_message: null,
          scenarioEvents_branchingStatus: false,
          scenarioEvents_branchInstruction: null,
        },
      ];

      repository.getSessionEventsByScenarioId.mockResolvedValue(
        mockRawEvents as any,
      );

      const result = await service.getSessionEventsByScenarioId(mockScenarioId);

      expect(result).toEqual([
        {
          id: 'event-3',
          name: null,
          description: null,
          score: null,
          emoji: null,
          message: null,
          branchInstruction: null,
          detectionType: undefined,
          visibilityType: undefined,
          feedbackStatus: false,
          sentences: undefined,
          speaker: undefined,
          createdAt: undefined,
          updatedAt: undefined,
        },
      ]);
    });

    it('should use fallback branchInstruction when scenarioEvents_branchInstruction is null', async () => {
      const mockRawEvents = [
        {
          sessionEvents_id: 'event-4',
          sessionEvents_name: 'Event 4',
          sessionEvents_description: 'Description 4',
          sessionEvents_score: 70,
          sessionEvents_emoji: '✨',
          sessionEvents_message: 'Default message 4',
          sessionEvents_branchInstruction: 'Fallback branch instruction',
          sessionEvents_detectionType:
            SessionEventDetectionType.SENTENCE_SIMILARITY,
          sessionEvents_visibilityType: SessionEventVisibilityType.ACTIVE,
          sessionEvents_sentences: ['Test sentence'],
          sessionEvents_speaker: SessionEventSpeaker.CARE_GIVER,
          sessionEvents_createdAt: new Date('2024-01-03T10:00:00Z'),
          sessionEvents_updatedAt: new Date('2024-01-03T10:00:00Z'),
          scenarioEvents_feedbackStatus: true,
          scenarioEvents_score: 80,
          scenarioEvents_emoji: '💡',
          scenarioEvents_message: 'Custom message 4',
          scenarioEvents_branchingStatus: true,
          scenarioEvents_branchInstruction: null, // null, so should use fallback
        },
      ];

      repository.getSessionEventsByScenarioId.mockResolvedValue(
        mockRawEvents as any,
      );

      const result = await service.getSessionEventsByScenarioId(mockScenarioId);

      expect(result).toEqual([
        {
          id: 'event-4',
          name: 'Event 4',
          description: 'Description 4',
          score: 80,
          emoji: '💡',
          message: 'Custom message 4',
          branchInstruction: 'Fallback branch instruction', // Uses fallback via ?? operator
          detectionType: SessionEventDetectionType.SENTENCE_SIMILARITY,
          visibilityType: SessionEventVisibilityType.ACTIVE,
          feedbackStatus: true,
          sentences: ['Test sentence'],
          speaker: SessionEventSpeaker.CARE_GIVER,
          createdAt: new Date('2024-01-03T10:00:00Z'),
          updatedAt: new Date('2024-01-03T10:00:00Z'),
        },
      ]);
      expect(repository.getSessionEventsByScenarioId).toHaveBeenCalledWith(
        mockScenarioId,
      );
    });
  });
});
