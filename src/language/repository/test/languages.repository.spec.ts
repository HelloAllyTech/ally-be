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
        where: { id: expect.any(Object) }, // In(ids) is an object produced by TypeORM
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

  describe('createLanguage', () => {
    it('should create and save a new language', async () => {
      const payload: Partial<Languages> = {
        value: 'fr',
        label: 'French',
        translationCode: 'fr-FR',
      };

      const createdEntity = { id: 2, ...payload } as Languages;
      mockRepository.create.mockReturnValue(createdEntity);
      mockRepository.save.mockResolvedValue(createdEntity);

      const result = await repository.createLanguage(payload);

      expect(mockRepository.create).toHaveBeenCalledWith(payload);
      expect(mockRepository.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toEqual(createdEntity);
    });
  });

  describe('updateLanguage', () => {
    it('should update language and return the updated entity', async () => {
      const id = 1;
      const updateData: Partial<Languages> = {
        label: 'English (Updated)',
      };

      const updatedEntity = { ...sampleLanguage, ...updateData } as Languages;

      // update returns void/UpdateResult — we just mock it as resolved value
      mockRepository.update.mockResolvedValue(undefined);
      mockRepository.findOne.mockResolvedValue(updatedEntity);

      const result = await repository.updateLanguage(id, updateData);

      // We expect update to be called with id and an object containing updateData and updatedAt
      expect(mockRepository.update).toHaveBeenCalledWith(
        id,
        expect.objectContaining(updateData),
      );

      // ensure updatedAt was included in the call
      const updateCallArg = (mockRepository.update as jest.Mock).mock
        .calls[0][1];
      expect(updateCallArg.updatedAt).toBeTruthy();
      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { id } });
      expect(result).toEqual(updatedEntity);
    });

    it('should return null when no language found after update', async () => {
      const id = 999;
      const updateData: Partial<Languages> = { label: 'Non-existent' };

      mockRepository.update.mockResolvedValue(undefined);
      mockRepository.findOne.mockResolvedValue(null);

      const result = await repository.updateLanguage(id, updateData);

      expect(mockRepository.update).toHaveBeenCalledWith(
        id,
        expect.objectContaining(updateData),
      );
      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { id } });
      expect(result).toBeNull();
    });
  });
});
