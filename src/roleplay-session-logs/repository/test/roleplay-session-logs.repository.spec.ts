import { DataSource } from 'typeorm';
import { RoleplaySessionLogsRepository } from '../roleplay-session-logs.repository';
import { ListRoleplaySessionLogsQueryDto } from '../../dto/roleplay-session-logs.dto';
import { ScenarioSessionStatus } from '../../../learn/enum/scenario-session-status.enum';

/**
 * The repository is pure SQL-building against a shared DataSource, so we assert
 * the WHERE predicates it emits (exclusions + filters) by inspecting the calls
 * made on a chainable query-builder mock.
 */
describe('RoleplaySessionLogsRepository', () => {
  let repository: RoleplaySessionLogsRepository;
  let builder: any;

  /** All SQL fragments passed to where()/andWhere() across the run. */
  const predicates = (): string[] => [
    ...builder.where.mock.calls.map((c: any[]) => c[0]),
    ...builder.andWhere.mock.calls.map((c: any[]) => c[0]),
  ];

  beforeEach(() => {
    builder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getRawOne: jest.fn().mockResolvedValue({ count: 0 }),
    };

    const dataSource = {
      createQueryBuilder: jest.fn().mockReturnValue(builder),
    } as unknown as DataSource;

    repository = new RoleplaySessionLogsRepository(dataSource);
  });

  afterEach(() => jest.clearAllMocks());

  describe('list', () => {
    it('always excludes admin-studio previews and dev seed rows', async () => {
      await repository.list({} as ListRoleplaySessionLogsQueryDto);

      const sql = predicates();
      expect(sql).toContain(`ss."roomId" NOT LIKE 'preview-%'`);
      expect(sql).toContain(`ss."roomId" NOT LIKE 'seed-room-%'`);
    });

    it('returns the count from the count query as total', async () => {
      builder.getRawOne.mockResolvedValueOnce({ count: 7 });
      const result = await repository.list(
        {} as ListRoleplaySessionLogsQueryDto,
      );
      expect(result.total).toBe(7);
      expect(result.rows).toEqual([]);
    });

    it('applies status, tenant, search and date filters when provided', async () => {
      await repository.list({
        status: ScenarioSessionStatus.ENDED,
        tenantId: 'tenant-1',
        search: 'alice',
        dateFrom: '2026-01-01',
        dateTo: '2026-02-01',
      } as ListRoleplaySessionLogsQueryDto);

      const sql = predicates();
      expect(sql).toContain('ss."status" = :status');
      expect(sql).toContain('ss."tenant_id" = :tenantId');
      expect(sql.some((s) => s.includes('ILIKE :search'))).toBe(true);
      expect(sql.some((s) => s.includes('>= :dateFrom'))).toBe(true);
      expect(sql.some((s) => s.includes('<= :dateTo'))).toBe(true);

      // search param is wrapped with wildcards
      const searchCall = builder.andWhere.mock.calls.find((c: any[]) =>
        c[0].includes('ILIKE :search'),
      );
      expect(searchCall[1]).toEqual({ search: '%alice%' });
    });

    it('does not add filter predicates when none are supplied', async () => {
      await repository.list({} as ListRoleplaySessionLogsQueryDto);
      const sql = predicates();
      expect(sql.some((s) => s.includes(':status'))).toBe(false);
      expect(sql.some((s) => s.includes(':tenantId'))).toBe(false);
      expect(sql.some((s) => s.includes(':search'))).toBe(false);
    });

    it('defaults to createdAt DESC ordering and given paging', async () => {
      await repository.list({
        limit: 50,
        offset: 100,
      } as ListRoleplaySessionLogsQueryDto);

      expect(builder.orderBy).toHaveBeenCalledWith(
        'ss."createdAt"',
        'DESC',
        'NULLS LAST',
      );
      expect(builder.limit).toHaveBeenCalledWith(50);
      expect(builder.offset).toHaveBeenCalledWith(100);
    });
  });

  describe('findOne', () => {
    it('returns null when no row is found', async () => {
      builder.getRawOne.mockResolvedValueOnce(undefined);
      const row = await repository.findOne('missing-id');
      expect(row).toBeNull();
    });

    it('queries cross-tenant (no tenant_id predicate) by session id', async () => {
      builder.getRawOne.mockResolvedValueOnce({ id: 'abc' });
      await repository.findOne('abc');
      const sql = predicates();
      expect(sql).toContain('ss.id = :id');
      expect(sql.some((s) => s.includes('tenant_id ='))).toBe(false);
    });
  });
});
