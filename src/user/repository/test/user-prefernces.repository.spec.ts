// user-preferences.repository.spec.ts
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { UserPreferencesRepository } from '../user-prefernces.repository';

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
    it('creates preferences when none exist', async () => {
      const incoming = { locale: 'en-IN' };

      const createdEntity = {
        userId: 321,
        tenantId: 'tenant123',
        data: incoming,
      };

      const savedEntity = {
        ...createdEntity,
        id: 'uuid',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      jest.spyOn(repo, 'findOne').mockResolvedValue(null as any);
      jest.spyOn(repo, 'create').mockReturnValue(createdEntity as any);
      jest.spyOn(repo, 'save').mockResolvedValue(savedEntity as any);

      const result = await repo.upsertUserPreferences(
        321,
        'tenant123',
        incoming,
      );

      expect(repo.findOne).toHaveBeenCalledWith({ where: { userId: 321 } });

      expect(repo.create).toHaveBeenCalledWith({
        userId: 321,
        tenantId: 'tenant123',
        data: incoming,
      });

      expect(repo.save).toHaveBeenCalledWith(createdEntity);
      expect(result).toBe(savedEntity);
    });

    it('updates existing preferences by merging data', async () => {
      const existing = {
        userId: 321,
        tenantId: 'tenant123',
        data: { theme: 'dark' },
      };

      const incoming = { locale: 'en-IN' };

      const saved = {
        ...existing,
        data: { theme: 'dark', locale: 'en-IN' },
      };

      jest.spyOn(repo, 'findOne').mockResolvedValue(existing as any);
      jest.spyOn(repo, 'save').mockResolvedValue(saved as any);

      const result = await repo.upsertUserPreferences(
        321,
        'tenant123',
        incoming,
      );

      expect(repo.findOne).toHaveBeenCalledWith({ where: { userId: 321 } });

      expect(repo.save).toHaveBeenCalledWith({
        ...existing,
        data: { theme: 'dark', locale: 'en-IN' },
      });

      expect(result).toBe(saved);
    });

    it('propagates errors from save()', async () => {
      const incoming = { locale: 'en-IN' };

      jest.spyOn(repo, 'findOne').mockResolvedValue(null as any);
      jest.spyOn(repo, 'create').mockReturnValue({} as any);
      jest.spyOn(repo, 'save').mockRejectedValue(new Error('db error'));

      await expect(
        repo.upsertUserPreferences(1, 'tenant123', incoming),
      ).rejects.toThrow('db error');
    });
  });
});
