import { DataSource } from 'typeorm';
import { ScenarioBehaviorInstructionTranslationRepository } from '../scenario-behavior-instruction-translation.repository';
import { ScenarioBehaviorInstructionTranslation } from 'src/learn/entity/scenario-behavior-instruction-translation.entity';

describe('ScenarioBehaviorInstructionTranslationRepository', () => {
  let repository: ScenarioBehaviorInstructionTranslationRepository;
  let mockDataSource: Partial<DataSource>;

  beforeEach(() => {
    mockDataSource = {
      createEntityManager: jest.fn().mockReturnValue({}),
    };

    repository = new ScenarioBehaviorInstructionTranslationRepository(
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

  describe('getTranslationsByInstructionId', () => {
    it('should call find with correct where clause', async () => {
      const expectedTranslations: ScenarioBehaviorInstructionTranslation[] = [
        {
          id: 'trans-uuid-1',
          scenarioBehaviorInstructionId: 'instruction-uuid-1',
          languageId: 2,
          instructions: ['Sea empático', 'Escuche con atención'],
        } as ScenarioBehaviorInstructionTranslation,
      ];

      const findSpy = jest
        .spyOn(repository, 'find')
        .mockResolvedValue(expectedTranslations);

      const result =
        await repository.getTranslationsByInstructionId('instruction-uuid-1');

      expect(findSpy).toHaveBeenCalledWith({
        where: { scenarioBehaviorInstructionId: 'instruction-uuid-1' },
      });
      expect(result).toEqual(expectedTranslations);
    });

    it('should return empty array when no translations exist', async () => {
      jest.spyOn(repository, 'find').mockResolvedValue([]);

      const result =
        await repository.getTranslationsByInstructionId('non-existent-id');

      expect(result).toEqual([]);
    });
  });

  describe('deleteByInstructionIds', () => {
    it('should not call delete when instructionIds is empty', async () => {
      const deleteSpy = jest.spyOn(repository, 'delete');

      await repository.deleteByInstructionIds([]);

      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('should call delete with In clause for given instruction ids', async () => {
      const deleteSpy = jest
        .spyOn(repository, 'delete')
        .mockResolvedValue({ affected: 2, raw: [] });

      await repository.deleteByInstructionIds([
        'instruction-uuid-1',
        'instruction-uuid-2',
      ]);

      expect(deleteSpy).toHaveBeenCalledWith({
        scenarioBehaviorInstructionId: expect.anything(),
      });
    });

    it('should call delete for a single instruction id', async () => {
      const deleteSpy = jest
        .spyOn(repository, 'delete')
        .mockResolvedValue({ affected: 1, raw: [] });

      await repository.deleteByInstructionIds(['instruction-uuid-1']);

      expect(deleteSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTranslationsForInstructions', () => {
    it('should return empty array when instructionIds is empty', async () => {
      const findSpy = jest.spyOn(repository, 'find');

      const result = await repository.getTranslationsForInstructions([], 2);

      expect(result).toEqual([]);
      expect(findSpy).not.toHaveBeenCalled();
    });

    it('should call find with correct where clause for multiple instruction ids', async () => {
      const expectedTranslations: ScenarioBehaviorInstructionTranslation[] = [
        {
          id: 'trans-uuid-1',
          scenarioBehaviorInstructionId: 'instruction-uuid-1',
          languageId: 2,
          instructions: ['Sea empático'],
        } as ScenarioBehaviorInstructionTranslation,
        {
          id: 'trans-uuid-2',
          scenarioBehaviorInstructionId: 'instruction-uuid-2',
          languageId: 2,
          instructions: ['Mantenga la calma'],
        } as ScenarioBehaviorInstructionTranslation,
      ];

      const findSpy = jest
        .spyOn(repository, 'find')
        .mockResolvedValue(expectedTranslations);

      const result = await repository.getTranslationsForInstructions(
        ['instruction-uuid-1', 'instruction-uuid-2'],
        2,
      );

      expect(findSpy).toHaveBeenCalledWith({
        where: {
          scenarioBehaviorInstructionId: expect.anything(),
          languageId: 2,
        },
      });
      expect(result).toEqual(expectedTranslations);
    });

    it('should return translations for a single instruction id', async () => {
      const expectedTranslation: ScenarioBehaviorInstructionTranslation = {
        id: 'trans-uuid-1',
        scenarioBehaviorInstructionId: 'instruction-uuid-1',
        languageId: 3,
        instructions: ['Soyez empathique'],
      } as ScenarioBehaviorInstructionTranslation;

      const findSpy = jest
        .spyOn(repository, 'find')
        .mockResolvedValue([expectedTranslation]);

      const result = await repository.getTranslationsForInstructions(
        ['instruction-uuid-1'],
        3,
      );

      expect(findSpy).toHaveBeenCalledWith({
        where: {
          scenarioBehaviorInstructionId: expect.anything(),
          languageId: 3,
        },
      });
      expect(result).toEqual([expectedTranslation]);
    });
  });
});
