// user-preferences.repository.spec.ts
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { UserPreferencesRepository } from '../user-prefernces.repository';
import { UserPreferences } from 'src/user/entity/user-preferences.entity';

type QB = any;

// Create a minimal mock EntityManager with required methods
const createMockEntityManager = (): Partial<EntityManager> => ({
  query: jest.fn(),
  createQueryBuilder: jest.fn(),
  hasId: jest.fn(),
  getId: jest.fn(),
  create: jest.fn(),
  merge: jest.fn(),
  preload: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  softRemove: jest.fn(),
  recover: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  softDelete: jest.fn(),
  restore: jest.fn(),
  count: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  findByIds: jest.fn(),
  findOne: jest.fn(),
  findOneOrFail: jest.fn(),
  clear: jest.fn(),
  increment: jest.fn(),
  decrement: jest.fn(),
  transaction: jest.fn(),
  queryRunner: {} as QueryRunner,
  connection: { driver: {} } as any,
});

describe('UserPreferencesRepository', () => {
  let repo: UserPreferencesRepository;
  let mockDataSource: Partial<DataSource>;
  let mockEntityManager: Partial<EntityManager>;

  beforeEach(() => {
    mockEntityManager = createMockEntityManager();

    mockDataSource = {
      createEntityManager: jest.fn(() => mockEntityManager as EntityManager),
    };

    // Create repository instance with the mocked DataSource
    repo = new UserPreferencesRepository(mockDataSource as DataSource);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('getUserPreferencesByUserId', () => {
    it('returns a user preferences row when found', async () => {
      const expected = { data: { default_language_id: 1 } };

      // Build a chainable mock for createQueryBuilder
      const getOne = jest.fn().mockResolvedValue(expected);
      const where = jest.fn().mockReturnValue({ getOne });
      const select = jest.fn().mockReturnValue({ where });

      const createQueryBuilder = jest
        .spyOn(repo as any, 'createQueryBuilder')
        .mockReturnValue({ select, where, getOne } as QB);

      const result = await repo.getUserPreferencesByUserId(123);

      expect(createQueryBuilder).toHaveBeenCalledWith('up');
      expect(select).toHaveBeenCalledWith('up.data');
      expect(where).toHaveBeenCalledWith('up."userId" = :userId', {
        userId: 123,
      });
      expect(getOne).toHaveBeenCalled();
      expect(result).toBe(expected);
    });

    it('returns null when not found', async () => {
      const getOne = jest.fn().mockResolvedValue(null);
      const where = jest.fn().mockReturnValue({ getOne });
      const select = jest.fn().mockReturnValue({ where });

      jest
        .spyOn(repo as any, 'createQueryBuilder')
        .mockReturnValue({ select, where, getOne } as QB);

      const result = await repo.getUserPreferencesByUserId(999);

      expect(result).toBeNull();
      expect(select).toHaveBeenCalled();
      expect(where).toHaveBeenCalledWith('up."userId" = :userId', {
        userId: 999,
      });
    });
  });

  describe('upsertUserPreferences', () => {
    it('inserts when not existing and returns result', async () => {
      const incoming = { locale: 'en-IN' };
      const execResult = {
        // mimic Postgres returning rows shape
        raw: [],
        generatedMaps: [],
        // TypeORM sometimes returns 'identifiers' and 'raw'. We'll assert the execute() return is forwarded.
        // Use a simple object for the test
        result: {
          id: 11,
          userId: 321,
          data: incoming,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      // Build the chainable query builder methods used by upsertUserPreferences
      const execute = jest.fn().mockResolvedValue(execResult);
      const setParameters = jest.fn().mockReturnValue({ execute });
      const returning = jest.fn().mockReturnValue({ setParameters, execute });
      const onConflict = jest
        .fn()
        .mockReturnValue({ returning, setParameters, execute });
      const values = jest
        .fn()
        .mockReturnValue({ onConflict, returning, setParameters, execute });
      const into = jest.fn().mockReturnValue({
        values,
        onConflict,
        returning,
        setParameters,
        execute,
      });
      const insert = jest.fn().mockReturnValue({
        into,
        values,
        onConflict,
        returning,
        setParameters,
        execute,
      });

      // We also expect the test to call createQueryBuilder() (no alias passed)
      const createQueryBuilder = jest
        .spyOn(repo as any, 'createQueryBuilder')
        .mockReturnValue({
          insert,
          into,
          values,
          onConflict,
          returning,
          setParameters,
          execute,
        } as QB);

      const res = await repo.upsertUserPreferences(321, incoming);

      expect(createQueryBuilder).toHaveBeenCalled();
      expect(insert).toHaveBeenCalled();
      expect(into).toHaveBeenCalledWith(UserPreferences);
      // check that values were provided (userId & data are parameters functions, so we at least assert values called)
      expect(values).toHaveBeenCalled();
      // onConflict SQL should be set
      expect(onConflict).toHaveBeenCalled();
      expect(returning).toHaveBeenCalledWith([
        'id',
        'userId',
        'data',
        'createdAt',
        'updatedAt',
      ]);
      expect(setParameters).toHaveBeenCalledWith({
        userId: 321,
        data: JSON.stringify(incoming),
      });
      expect(execute).toHaveBeenCalled();
      expect(res).toBe(execResult);
    });

    it('propagates errors from execute()', async () => {
      const incoming = { foo: 'bar' };
      const execute = jest.fn().mockRejectedValue(new Error('db error'));
      const setParameters = jest.fn().mockReturnValue({ execute });
      const returning = jest.fn().mockReturnValue({ setParameters, execute });
      const onConflict = jest
        .fn()
        .mockReturnValue({ returning, setParameters, execute });
      const values = jest
        .fn()
        .mockReturnValue({ onConflict, returning, setParameters, execute });
      const into = jest.fn().mockReturnValue({
        values,
        onConflict,
        returning,
        setParameters,
        execute,
      });
      const insert = jest.fn().mockReturnValue({
        into,
        values,
        onConflict,
        returning,
        setParameters,
        execute,
      });

      jest.spyOn(repo as any, 'createQueryBuilder').mockReturnValue({
        insert,
        into,
        values,
        onConflict,
        returning,
        setParameters,
        execute,
      } as QB);

      await expect(repo.upsertUserPreferences(7, incoming)).rejects.toThrow(
        'db error',
      );

      expect(setParameters).toHaveBeenCalledWith({
        userId: 7,
        data: JSON.stringify(incoming),
      });
      expect(execute).toHaveBeenCalled();
    });
  });
});
