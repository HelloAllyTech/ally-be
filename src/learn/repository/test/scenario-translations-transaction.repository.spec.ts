import { DataSource, EntityManager } from 'typeorm';
import { ScenarioTranslationsRepository } from '../scenario-translations.repository';
import { ScenarioTranslations } from 'src/learn/entity/scenario-translation.entity';

// publishVersion runs the translation upserts inside its own transaction,
// which already holds a row lock on `scenarios`. A write that opened a second
// connection here would wait on that lock until statement_timeout.
describe('ScenarioTranslationsRepository (caller-owned transaction)', () => {
  let repository: ScenarioTranslationsRepository;
  let mockDataSource: Partial<DataSource>;

  beforeEach(() => {
    mockDataSource = {
      transaction: jest.fn(),
      createEntityManager: jest.fn().mockReturnValue({}),
    };
    repository = new ScenarioTranslationsRepository(
      mockDataSource as DataSource,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('updateScenarioTranslations reuses the given manager instead of opening a transaction', async () => {
    const manager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as EntityManager;

    const res = await repository.updateScenarioTranslations(
      [{ scenarioId: 10, languageId: 2, metadata: { title: 'Título' } }],
      manager,
    );

    expect(mockDataSource.transaction).not.toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledWith(
      ScenarioTranslations,
      { scenarioId: 10, languageId: 2 },
      { metadata: { title: 'Título' } },
    );
    expect(res).toEqual({ success: true });
  });

  it('updateScenarioTranslations still opens its own transaction without a manager', async () => {
    const transactionalEntityManager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    (mockDataSource.transaction as jest.Mock).mockImplementation(
      async (cb: (manager: any) => Promise<void>) => {
        await cb(transactionalEntityManager);
      },
    );

    await repository.updateScenarioTranslations([
      { scenarioId: 10, languageId: 2, metadata: { title: 'Título' } },
    ]);

    expect(mockDataSource.transaction).toHaveBeenCalledTimes(1);
    expect(transactionalEntityManager.update).toHaveBeenCalledTimes(1);
  });

  it('reads and creates through the given manager', async () => {
    const rows = [{ id: 1, scenarioId: 10, languageId: 2, metadata: {} }];
    const managerRepo = {
      find: jest.fn().mockResolvedValue(rows),
      create: jest.fn((x) => x),
      save: jest.fn().mockResolvedValue(rows),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(managerRepo),
    } as unknown as EntityManager;
    const ownFind = jest.spyOn(repository, 'find');
    const ownSave = jest.spyOn(repository, 'save');

    await repository.getScenarioTranslationsByScenarioId(10, manager);
    await repository.createScenarioTranslations(
      [{ scenarioId: 10, languageId: 2, metadata: { title: 'x' } }],
      manager,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(ScenarioTranslations);
    expect(managerRepo.find).toHaveBeenCalledWith({
      where: { scenarioId: 10 },
    });
    expect(managerRepo.save).toHaveBeenCalled();
    expect(ownFind).not.toHaveBeenCalled();
    expect(ownSave).not.toHaveBeenCalled();
  });
});
