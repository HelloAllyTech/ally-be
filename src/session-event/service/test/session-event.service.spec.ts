import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { SessionEventService } from '../session-event.service';
import { SessionEvents } from '../../entity/session-events.entity';
import { CreateSessionEventDto } from '../../dto/create-session-event.dto';
import { UpdateSessionEventDto } from '../../dto/update-session-event.dto';

describe('SessionEventService', () => {
  let service: SessionEventService;
  let repository: jest.Mocked<Repository<SessionEvents>>;

  const mockSessionEvent: SessionEvents = {
    id: 'event-1',
    name: 'Test Event',
    description: 'Test event description',
    score: 85,
    emoji: '👍',
    message: 'Great job!',
    branchInstruction: 'Continue with next step',
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
    getMany: jest.fn(),
  };

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionEventService,
        {
          provide: getRepositoryToken(SessionEvents),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<SessionEventService>(SessionEventService);
    repository = module.get(getRepositoryToken(SessionEvents));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSessionEvents', () => {
    it('should create session events successfully', async () => {
      const createEventDtos = [mockCreateSessionEventDto];
      const createdEvents = [mockSessionEvent];

      repository.create.mockReturnValue(createdEvents as any);
      repository.save.mockResolvedValue(createdEvents as any);

      const result = await service.createSessionEvents(createEventDtos);

      expect(repository.create).toHaveBeenCalledWith(createEventDtos);
      expect(repository.save).toHaveBeenCalledWith(createdEvents);
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

      repository.create.mockReturnValue(createdEvents as any);
      repository.save.mockResolvedValue(createdEvents as any);

      const result = await service.createSessionEvents(createEventDtos);

      expect(repository.create).toHaveBeenCalledWith(createEventDtos);
      expect(repository.save).toHaveBeenCalledWith(createdEvents);
      expect(result).toEqual(createdEvents);
    });

    it('should handle empty array input', async () => {
      const createEventDtos: CreateSessionEventDto[] = [];
      const createdEvents: SessionEvents[] = [];

      repository.create.mockReturnValue(createdEvents as any);
      repository.save.mockResolvedValue(createdEvents as any);

      const result = await service.createSessionEvents(createEventDtos);

      expect(repository.create).toHaveBeenCalledWith(createEventDtos);
      expect(repository.save).toHaveBeenCalledWith(createdEvents);
      expect(result).toEqual(createdEvents);
    });

    it('should handle repository create error', async () => {
      const createEventDtos = [mockCreateSessionEventDto];
      const error = new Error('Database error');

      repository.create.mockImplementation(() => {
        throw error;
      });

      await expect(
        service.createSessionEvents(createEventDtos),
      ).rejects.toThrow('Database error');
      expect(repository.create).toHaveBeenCalledWith(createEventDtos);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('should handle repository save error', async () => {
      const createEventDtos = [mockCreateSessionEventDto];
      const createdEvents = [mockSessionEvent];
      const error = new Error('Save failed');

      repository.create.mockReturnValue(createdEvents as any);
      repository.save.mockRejectedValue(error);

      await expect(
        service.createSessionEvents(createEventDtos),
      ).rejects.toThrow('Save failed');
      expect(repository.create).toHaveBeenCalledWith(createEventDtos);
      expect(repository.save).toHaveBeenCalledWith(createdEvents);
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
        expect.anything(), // ScenarioEvents class
        'scenarioEvents',
        'scenarioEvents.eventId = sessionEvents.id',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvents.scenarioId = :scenarioId',
        { scenarioId: scenarioId },
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
        expect.anything(),
        'scenarioEvents',
        'scenarioEvents.eventId = sessionEvents.id',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'scenarioEvents.scenarioId = :scenarioId',
        { scenarioId: scenarioId },
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
        'scenarioEvents.scenarioId = :scenarioId',
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
        'scenarioEvents.scenarioId = :scenarioId',
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
});
