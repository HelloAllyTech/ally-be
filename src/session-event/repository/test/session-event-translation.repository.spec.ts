import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import { SessionEventTranslationsRepository } from '../session-event-translation.repository';
import { SessionEventsTranslation } from 'src/session-event/entity/session-event-translation.entity';
import { CreateSessionEventTranslation } from 'src/session-event/interface/session-events-translation.interface';

describe('SessionEventTranslationsRepository', () => {
  let repository: SessionEventTranslationsRepository;
  let mockRepository: jest.Mocked<
    Partial<Repository<SessionEventsTranslation>>
  >;
  let mockDataSource: jest.Mocked<DataSource>;

  const mockTranslation = {
    id: 1,
    sessionEventId: 'event-1',
    languageId: 1,
    message: 'Test message',
    branchInstruction: 'Test instruction',
    detectionData: { key: 'value' },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as SessionEventsTranslation;

  beforeEach(async () => {
    // create a set of mocked repository methods we will attach to the real instance
    mockRepository = {
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
    };

    mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
      transaction: jest.fn().mockImplementation((cb) =>
        cb({
          update: jest.fn().mockResolvedValue({}),
        }),
      ),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionEventTranslationsRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<SessionEventTranslationsRepository>(
      SessionEventTranslationsRepository,
    );

    // IMPORTANT: overwrite the repository instance's TypeORM methods with our mocks
    Object.assign(repository as any, {
      find: mockRepository.find,
      create: mockRepository.create,
      save: mockRepository.save,
      update: mockRepository.update,
      findOne: mockRepository.findOne,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSessionEventTranslationsBySessionEventId', () => {
    it('should return translations for a session event', async () => {
      const sessionEventId = 'event-1';
      (mockRepository.find as jest.Mock).mockResolvedValue([mockTranslation]);

      const result =
        await repository.getSessionEventTranslationsBySessionEventId(
          sessionEventId,
        );

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { sessionEventId: String(sessionEventId) },
      });
      expect(result).toEqual([mockTranslation]);
    });

    it('should return empty array when no translations found', async () => {
      (mockRepository.find as jest.Mock).mockResolvedValue([]);

      const result =
        await repository.getSessionEventTranslationsBySessionEventId(
          'nonexistent',
        );

      expect(mockRepository.find).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('createSessionEventTranslations', () => {
    it('should create new translations', async () => {
      const newTranslations: CreateSessionEventTranslation[] = [
        {
          sessionEventId: 'event-1',
          languageId: 1,
          message: 'New message',
          branchInstruction: 'Test branch instruction',
          detectionData: { sentences: ['value-1', 'value-2'] },
        },
      ];

      (mockRepository.create as jest.Mock).mockReturnValue(
        newTranslations as any,
      );
      (mockRepository.save as jest.Mock).mockResolvedValue(
        newTranslations as any,
      );

      const result =
        await repository.createSessionEventTranslations(newTranslations);

      expect(mockRepository.create).toHaveBeenCalledWith(newTranslations);
      expect(mockRepository.save).toHaveBeenCalledWith(newTranslations);
      expect(result).toEqual({ success: true });
    });
  });

  describe('updateSessionTranslations', () => {
    it('should update translations within a transaction', async () => {
      const updateDtos = [
        {
          sessionEventId: 'event-1',
          languageId: 1,
          message: 'Updated message',
          branchInstruction: 'Updated instruction',
          detectionData: { sentences: ['updated'] },
        },
      ];

      const result = await repository.updateSessionTranslations(updateDtos);

      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should handle empty array of translations', async () => {
      const result = await repository.updateSessionTranslations([]);
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });
});
