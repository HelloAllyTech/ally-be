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
}

describe('LanguagesRepository', () => {
  let repository: LanguagesRepository;
  let mockRepository: MockRepository;

  const sampleLanguage: Languages = {
    id: 1,
    value: 'en-IN',
    label: 'English (India)',
    translationCode: 'en',
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
        select: ['id', 'value', 'label', 'translationCode'],
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
});
