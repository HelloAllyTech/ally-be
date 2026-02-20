import { DataSource } from 'typeorm';
import { BehaviorTranslationRepository } from '../behavior-translation.repository';
import { BehaviorTranslation } from 'src/learn/entity/behavior-translation.entity';

describe('BehaviorTranslationRepository', () => {
  let repository: BehaviorTranslationRepository;
  let mockDataSource: Partial<DataSource>;

  beforeEach(() => {
    mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
    };

    repository = new BehaviorTranslationRepository(
      mockDataSource as DataSource,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('should be instantiated', () => {
    expect(repository).toBeDefined();
  });

  describe('getTranslationsByBehaviorId', () => {
    it('should call find with correct where clause', async () => {
      const expectedTranslations: BehaviorTranslation[] = [
        {
          id: 'trans-uuid-1',
          behaviorId: 'behavior-uuid-1',
          languageId: 2,
          name: 'Escucha Activa',
        } as BehaviorTranslation,
      ];

      const findSpy = jest
        .spyOn(repository, 'find')
        .mockResolvedValue(expectedTranslations);

      const result =
        await repository.getTranslationsByBehaviorId('behavior-uuid-1');

      expect(findSpy).toHaveBeenCalledWith({
        where: { behaviorId: 'behavior-uuid-1' },
      });
      expect(result).toEqual(expectedTranslations);
    });

    it('should return empty array when no translations exist', async () => {
      jest.spyOn(repository, 'find').mockResolvedValue([]);

      const result =
        await repository.getTranslationsByBehaviorId('non-existent-id');

      expect(result).toEqual([]);
    });
  });

  describe('getTranslationsForBehaviors', () => {
    it('should return empty array when behaviorIds is empty', async () => {
      const findSpy = jest.spyOn(repository, 'find');

      const result = await repository.getTranslationsForBehaviors([], 2);

      expect(result).toEqual([]);
      expect(findSpy).not.toHaveBeenCalled();
    });

    it('should call find with correct where clause for multiple behavior ids', async () => {
      const expectedTranslations: BehaviorTranslation[] = [
        {
          id: 'trans-uuid-1',
          behaviorId: 'behavior-uuid-1',
          languageId: 2,
          name: 'Escucha Activa',
        } as BehaviorTranslation,
        {
          id: 'trans-uuid-2',
          behaviorId: 'behavior-uuid-2',
          languageId: 2,
          name: 'Empatía',
        } as BehaviorTranslation,
      ];

      const findSpy = jest
        .spyOn(repository, 'find')
        .mockResolvedValue(expectedTranslations);

      const result = await repository.getTranslationsForBehaviors(
        ['behavior-uuid-1', 'behavior-uuid-2'],
        2,
      );

      expect(findSpy).toHaveBeenCalledWith({
        where: {
          behaviorId: expect.anything(),
          languageId: 2,
        },
      });
      expect(result).toEqual(expectedTranslations);
    });

    it('should call find with single behavior id', async () => {
      const expectedTranslations: BehaviorTranslation[] = [
        {
          id: 'trans-uuid-1',
          behaviorId: 'behavior-uuid-1',
          languageId: 3,
          name: 'Écoute Active',
        } as BehaviorTranslation,
      ];

      const findSpy = jest
        .spyOn(repository, 'find')
        .mockResolvedValue(expectedTranslations);

      const result = await repository.getTranslationsForBehaviors(
        ['behavior-uuid-1'],
        3,
      );

      expect(findSpy).toHaveBeenCalledWith({
        where: {
          behaviorId: expect.anything(),
          languageId: 3,
        },
      });
      expect(result).toEqual(expectedTranslations);
    });
  });
});
