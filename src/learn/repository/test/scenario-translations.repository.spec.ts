import { DataSource } from 'typeorm';
import { ScenarioEventsTranslationsRepository } from '../scenario-events-translations.repository';
import { ScenarioEventsTranslation } from 'src/learn/entity/scenario-events-translation.entity';
import {
  CreateScenarioEventsTranslationDto,
  UpdateScenarioEventsTranslationDto,
} from 'src/learn/dto/scenario-events-translation.dto';

describe('ScenarioEventsTranslationsRepository', () => {
  let repository: ScenarioEventsTranslationsRepository;
  let mockDataSource: Partial<DataSource>;

  beforeEach(() => {
    // mock DataSource with transaction and createEntityManager
    mockDataSource = {
      // transaction will accept a callback and we will call it synchronously with a fake transactional manager
      transaction: jest.fn(),
      // createEntityManager is required by the Repository super-constructor but not used directly in our tests
      createEntityManager: jest.fn().mockReturnValue({}),
    };

    // instantiate repository with mocked DataSource
    repository = new ScenarioEventsTranslationsRepository(
      mockDataSource as DataSource,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('getScenarioEventsTranslationsByScenarioIdEventId', () => {
    it('should call find with correct where clause and return results', async () => {
      const scenarioId = 42;
      const eventId = 'EVT_1';
      const expected: ScenarioEventsTranslation[] = [
        {
          id: 1,
          scenarioId,
          eventId,
          languageId: 4,
          message: 'Hello',
          branchInstruction: null,
        } as unknown as ScenarioEventsTranslation,
      ];

      // spy on inherited find
      const findSpy = jest
        .spyOn(repository, 'find')
        .mockResolvedValue(expected);

      const result =
        await repository.getScenarioEventsTranslationsByScenarioIdEventId(
          scenarioId,
          eventId,
        );

      expect(findSpy).toHaveBeenCalledWith({
        where: { scenarioId, eventId },
      });
      expect(result).toBe(expected);
    });
  });

  describe('createTranslations', () => {
    it('should call create and save and return success response', async () => {
      const translations: CreateScenarioEventsTranslationDto[] = [
        {
          scenarioId: 1,
          eventId: 'E1',
          languageId: 2,
          message: 'msg',
          branchInstruction: undefined,
        },
      ];

      const createdEntities = translations.map((t, i) =>
        Object.assign(new ScenarioEventsTranslation(), { ...t, id: i + 1 }),
      );

      // mock repository.create and repository.save (inherited methods)
      const createSpy = jest
        .spyOn(repository, 'create')
        .mockReturnValue(createdEntities as any);
      const saveSpy = jest
        .spyOn(repository, 'save')
        .mockResolvedValue(createdEntities as any);

      const res = await repository.createTranslations(translations);

      expect(createSpy).toHaveBeenCalledWith(translations);
      expect(saveSpy).toHaveBeenCalledWith(createdEntities as any);
      expect(res).toEqual({ success: true });
    });
  });

  describe('updateTranslations', () => {
    it('should call DataSource.transaction and update each translation', async () => {
      const translations: UpdateScenarioEventsTranslationDto[] = [
        {
          scenarioId: 10,
          eventId: 'EV_A',
          languageId: 2,
          message: 'New message',
        },
        {
          scenarioId: 10,
          eventId: 'EV_B',
          languageId: 3,
          branchInstruction: 'GOTO_2',
        },
      ];

      // create a fake transactionalEntityManager with update spy
      const transactionalEntityManager = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      // mock dataSource.transaction to call the provided callback with the fake manager
      (mockDataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (manager: any) => Promise<void>) => {
          // call callback with our fake manager
          await cb(transactionalEntityManager);
        },
      );

      // call method
      const res = await repository.updateTranslations(translations);

      // expect transaction to be called
      expect(mockDataSource.transaction).toHaveBeenCalled();

      // expect update invoked for each translation with correct where and update values
      expect(transactionalEntityManager.update).toHaveBeenCalledTimes(2);

      expect(transactionalEntityManager.update).toHaveBeenNthCalledWith(
        1,
        ScenarioEventsTranslation,
        { scenarioId: 10, eventId: 'EV_A', languageId: 2 },
        { message: 'New message' },
      );

      expect(transactionalEntityManager.update).toHaveBeenNthCalledWith(
        2,
        ScenarioEventsTranslation,
        { scenarioId: 10, eventId: 'EV_B', languageId: 3 },
        { branchInstruction: 'GOTO_2' },
      );

      expect(res).toEqual({ success: true });
    });

    it('should not include undefined fields in update payload', async () => {
      const translations: UpdateScenarioEventsTranslationDto[] = [
        {
          scenarioId: 99,
          eventId: 'EV_TEST',
          languageId: 4,
          // both message and branchInstruction undefined -> nothing should update (but transaction should still run)
        } as UpdateScenarioEventsTranslationDto,
      ];

      const transactionalEntityManager = {
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      (mockDataSource.transaction as jest.Mock).mockImplementation(
        async (cb: (manager: any) => Promise<void>) => {
          await cb(transactionalEntityManager);
        },
      );

      const res = await repository.updateTranslations(translations);

      // It should call update with an empty object because the repository code spreads only defined fields
      expect(transactionalEntityManager.update).toHaveBeenCalledWith(
        ScenarioEventsTranslation,
        { scenarioId: 99, eventId: 'EV_TEST', languageId: 4 },
        {},
      );

      expect(res).toEqual({ success: true });
    });
  });
});
