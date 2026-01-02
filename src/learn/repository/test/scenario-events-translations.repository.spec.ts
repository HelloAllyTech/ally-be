import { DataSource } from 'typeorm';
import { ScenarioEventsTranslationsRepository } from '../scenario-events-translations.repository';
import { ScenarioEventsTranslation } from 'src/learn/entity/scenario-events-translation.entity';

describe('ScenarioEventsTranslationsRepository', () => {
  let dataSourceMock: Partial<DataSource>;
  let repo: ScenarioEventsTranslationsRepository;

  beforeEach(() => {
    dataSourceMock = {
      // createEntityManager must exist because the repository constructor calls it
      createEntityManager: jest.fn().mockReturnValue({}),
      // transaction will be spied/mocked per-test where needed
      transaction: jest.fn(),
    };

    // instantiate repository with the mocked DataSource
    repo = new ScenarioEventsTranslationsRepository(
      dataSourceMock as unknown as DataSource,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('find methods', () => {
    it('getScenarioEventTranslationsBySessionEventId should call find with scenarioId and eventId', async () => {
      const scenarioId = 42;
      const eventId = 'evt-1';
      const mockTranslations = [
        {
          id: 'string',
          scenarioId: 1,
          eventId: 'event-1',
          languageId: 2,
          message: 'Test message',
          branchInstruction: 'Test instruction',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      const expectedResult: ScenarioEventsTranslation[] = mockTranslations;

      // spy on instance find
      (repo as any).find = jest.fn().mockResolvedValue(mockTranslations);

      const result =
        await repo.getScenarioEventsTranslationsByScenarioIdEventId(
          scenarioId,
          eventId,
        );

      expect((repo as any).find).toHaveBeenCalledWith({
        where: { scenarioId, eventId },
      });
      expect(result).toBe(expectedResult);
    });
  });

  describe('createTranslations', () => {
    it('should call create and save and return success', async () => {
      const translations = [
        { scenarioId: 1, eventId: 'e1', languageId: 1, message: 'hi' },
      ];

      const createdEntities = [{ id: 1, ...translations[0] }];

      // mock create to return createdEntities (TypeORM create usually returns entity instances)
      (repo as any).create = jest.fn().mockReturnValue(createdEntities);
      (repo as any).save = jest.fn().mockResolvedValue(createdEntities);

      const res = await repo.createTranslations(translations as any);

      expect((repo as any).create).toHaveBeenCalledWith(translations);
      expect((repo as any).save).toHaveBeenCalledWith(createdEntities);
      expect(res).toEqual({ success: true });
    });
  });

  describe('updateTranslations', () => {
    it('should run transaction and call update for each translation with only defined fields', async () => {
      const translations = [
        // full update (message + branchInstruction)
        {
          scenarioId: 1,
          eventId: 'e1',
          languageId: 1,
          message: 'msg 1',
          branchInstruction: 'branch A',
        },
        // partial update (only message)
        {
          scenarioId: 1,
          eventId: 'e1',
          languageId: 2,
          message: 'msg 2',
          branchInstruction: undefined,
        },
        // partial update (only branchInstruction)
        {
          scenarioId: 2,
          eventId: 'e2',
          languageId: 3,
          message: undefined,
          branchInstruction: 'branch B',
        },
      ];

      // prepare a transactionalEntityManager mock with update spy
      const updateMock = jest.fn().mockResolvedValue(undefined);
      const transactionalEntityManager = {
        update: updateMock,
      };

      // dataSource.transaction should invoke the callback with transactionalEntityManager
      (dataSourceMock.transaction as jest.Mock).mockImplementation(
        async (cb: (em: any) => Promise<void>) => {
          // simulate TypeORM transaction callback invocation
          await cb(transactionalEntityManager);
        },
      );

      // Re-create repo with the same mocked dataSource so that repo.dataSource.transaction is used
      repo = new ScenarioEventsTranslationsRepository(
        dataSourceMock as unknown as DataSource,
      );

      const res = await repo.updateTranslations(translations as any);

      expect(dataSourceMock.transaction).toHaveBeenCalled();
      // we expect three updates (one per translation)
      expect(updateMock).toHaveBeenCalledTimes(translations.length);

      // validate first call (both message and branchInstruction present)
      expect(updateMock).toHaveBeenCalledWith(
        ScenarioEventsTranslation,
        { scenarioId: 1, eventId: 'e1', languageId: 1 },
        { message: 'msg 1', branchInstruction: 'branch A' },
      );

      // validate second call (only message)
      expect(updateMock).toHaveBeenCalledWith(
        ScenarioEventsTranslation,
        { scenarioId: 1, eventId: 'e1', languageId: 2 },
        { message: 'msg 2' },
      );

      // validate third call (only branchInstruction)
      expect(updateMock).toHaveBeenCalledWith(
        ScenarioEventsTranslation,
        { scenarioId: 2, eventId: 'e2', languageId: 3 },
        { branchInstruction: 'branch B' },
      );

      expect(res).toEqual({ success: true });
    });

    it('should still return success when transaction resolves immediately (no translations)', async () => {
      // empty array: transaction should still be called but update never called
      const translations: any[] = [];

      const updateMock = jest.fn();
      const transactionalEntityManager = { update: updateMock };

      (dataSourceMock.transaction as jest.Mock).mockImplementation(
        async (cb: (em: any) => Promise<void>) => {
          await cb(transactionalEntityManager);
        },
      );

      repo = new ScenarioEventsTranslationsRepository(
        dataSourceMock as unknown as DataSource,
      );

      const res = await repo.updateTranslations(translations);

      expect(dataSourceMock.transaction).toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(res).toEqual({ success: true });
    });
  });
});
