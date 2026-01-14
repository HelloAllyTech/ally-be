import { Test, TestingModule } from '@nestjs/testing';
import { LanguagesRepository } from '../languages.repository';
import { Languages } from '../../entity/languages.entity';
import { DataSource } from 'typeorm';

class MockRepository {
  find = jest.fn();
  create = jest.fn();
  save = jest.fn();
  update = jest.fn();
  findOne = jest.fn();
  createQueryBuilder = jest.fn();
}

describe('LanguagesRepository', () => {
  let repository: LanguagesRepository;
  let mockRepository: MockRepository;

  const sampleLanguage: Languages = {
    id: 1,
    value: 'en-IN',
    label: 'English (India)',
    translationCode: 'en',
    llmProviderConfig: {},
    sttProviderConfig: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Languages;

  beforeEach(async () => {
    mockRepository = new MockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LanguagesRepository,
        {
          provide: DataSource,
          useValue: {
            // ensure createEntityManager exists so the repository constructor doesn't crash
            createEntityManager: jest.fn().mockReturnValue({}),
          },
        },
      ],
    }).compile();

    repository = module.get<LanguagesRepository>(LanguagesRepository);

    // overwrite TypeORM methods on the repository instance with our mocks
    Object.assign(repository as any, {
      find: mockRepository.find,
      create: mockRepository.create,
      save: mockRepository.save,
      update: mockRepository.update,
      findOne: mockRepository.findOne,
      createQueryBuilder: mockRepository.createQueryBuilder,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('getLanguagesById', () => {
    it('should call find with select and In(ids) and return languages', async () => {
      const ids = [1, 2, 3];
      const expectedResult = [sampleLanguage];

      mockRepository.find.mockResolvedValue(expectedResult);

      const result = await repository.getLanguagesById(ids);

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { id: expect.any(Object), active: true }, // In(ids) is an object produced by TypeORM
      });
      expect(result).toEqual(expectedResult);
    });

    it('should return empty array when none found', async () => {
      const ids: number[] = [];
      mockRepository.find.mockResolvedValue([]);

      const result = await repository.getLanguagesById(ids);

      expect(mockRepository.find).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('getLanguages', () => {
    const mockLanguages: Languages[] = [
      {
        id: 1,
        value: 'en-IN',
        label: 'English (India)',
        translationCode: 'en',
        active: true,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      } as Languages,
      {
        id: 2,
        value: 'hi-IN',
        label: 'Hindi (India)',
        translationCode: 'hi',
        active: true,
        llmProviderConfig: {},
        sttProviderConfig: {},
        createdAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-02'),
      } as Languages,
      {
        id: 3,
        value: 'es-ES',
        label: 'Spanish (Spain)',
        translationCode: 'es',
        active: true,
        llmProviderConfig: {},
        sttProviderConfig: {},
        createdAt: new Date('2024-01-03'),
        updatedAt: new Date('2024-01-03'),
      } as Languages,
    ];

    it('should return all languages without filters', async () => {
      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockLanguages),
      };

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await repository.getLanguages(undefined, {
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual(mockLanguages);
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });

    it('should apply search filter when searchName is provided', async () => {
      const filteredLanguages = [mockLanguages[0]];
      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(filteredLanguages),
      };

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await repository.getLanguages('english', {
        limit: 10,
        offset: 0,
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
      expect(mockQueryBuilder.setParameters).toHaveBeenCalled();
      expect(result).toEqual(filteredLanguages);
    });

    it('should apply sorting with custom sortBy and order', async () => {
      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockLanguages),
      };

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await repository.getLanguages(undefined, {
        limit: 10,
        offset: 0,
        sortBy: 'value',
        order: 'DESC',
      });

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'language.value',
        'DESC',
      );
    });

    it('should apply pagination with limit and offset', async () => {
      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockLanguages[0]]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await repository.getLanguages(undefined, {
        limit: 20,
        offset: 40,
      });

      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(40);
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(20);
    });

    it('should return empty array when no results found', async () => {
      const mockQueryBuilder = {
        createQueryBuilder: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await repository.getLanguages('nonexistent', {
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual([]);
    });
  });
});
