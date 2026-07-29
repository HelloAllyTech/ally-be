import { Test, TestingModule } from '@nestjs/testing';
import { OrgHealthAnalyticsService } from '../org-health-analytics.service';
import { MIN_ORG_GROUP_SIZE } from '../../repository/highlights-analytics.repository';
import {
  ORG_HEALTH_TREND_WEEKS,
  OrgHealthAnalyticsRepository,
  OrgHealthRow,
  OrgHealthTrendRow,
} from '../../repository/org-health-analytics.repository';

// Fixed "now" = Wednesday 2024-06-12T12:00:00Z. The trailing 12 ISO weeks
// therefore start on Monday 2024-03-25 and end with the current (partial) week,
// Monday 2024-06-10.
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

const org = (over: Partial<OrgHealthRow> = {}): OrgHealthRow => ({
  tenantId: 'org-1',
  tenantName: 'Org One',
  code: 'one',
  learners: 20,
  activeLearners28d: 6,
  completedSimulations: 100,
  completedLast28d: 10,
  completedPrev28d: 12,
  lastCompletedAt: new Date('2024-06-01T00:00:00.000Z'),
  creditLimit: 200,
  consumedCredits: 50,
  learnersWithCreditLimit: 20,
  ...over,
});

describe('OrgHealthAnalyticsService', () => {
  let service: OrgHealthAnalyticsService;
  let repository: jest.Mocked<OrgHealthAnalyticsRepository>;

  const setup = async (
    rows: OrgHealthRow[] = [],
    trend: OrgHealthTrendRow[] = [],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgHealthAnalyticsService,
        {
          provide: OrgHealthAnalyticsRepository,
          useValue: {
            getOrgRows: jest.fn().mockResolvedValue(rows),
            getWeeklyTrend: jest.fn().mockResolvedValue(trend),
          },
        },
      ],
    }).compile();

    service = module.get(OrgHealthAnalyticsService);
    repository = module.get(OrgHealthAnalyticsRepository);
  };

  beforeEach(() => jest.useFakeTimers().setSystemTime(FIXED_NOW));
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('publishes one shared 12-ISO-week axis, oldest first', async () => {
    await setup();

    const result = await service.getOrgHealth({});

    expect(result.trendBuckets).toHaveLength(ORG_HEALTH_TREND_WEEKS);
    expect(result.trendBuckets[0]).toBe('2024-03-25');
    expect(result.trendBuckets[ORG_HEALTH_TREND_WEEKS - 1]).toBe('2024-06-10');
    expect(result.minGroupSize).toBe(MIN_ORG_GROUP_SIZE);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('aligns each sparkline to the shared axis and zero-fills the quiet weeks', async () => {
    await setup(
      [org()],
      [
        { tenantId: 'org-1', bucket: '2024-03-25', count: 4 },
        { tenantId: 'org-1', bucket: '2024-06-10', count: 7 },
        // A week outside the axis must not shift the series it is not part of.
        { tenantId: 'org-1', bucket: '2024-03-18', count: 99 },
      ],
    );

    const result = await service.getOrgHealth({});

    const trend = result.orgs[0].trend;
    expect(trend).toHaveLength(ORG_HEALTH_TREND_WEEKS);
    expect(trend[0]).toBe(4);
    expect(trend[ORG_HEALTH_TREND_WEEKS - 1]).toBe(7);
    expect(trend.slice(1, ORG_HEALTH_TREND_WEEKS - 1)).toEqual(
      new Array(ORG_HEALTH_TREND_WEEKS - 2).fill(0),
    );
  });

  it('counts whole days of silence and keeps it null for an org that never started', async () => {
    await setup([
      org({ tenantId: 'a', tenantName: 'A' }),
      org({
        tenantId: 'b',
        tenantName: 'B',
        completedSimulations: 0,
        completedLast28d: 0,
        completedPrev28d: 0,
        lastCompletedAt: null,
      }),
    ]);

    const result = await service.getOrgHealth({});

    const a = result.orgs.find((o) => o.tenantId === 'a')!;
    expect(a.lastCompletedAt).toBe('2024-06-01T00:00:00.000Z');
    expect(a.daysSinceLastCompleted).toBe(11);

    const b = result.orgs.find((o) => o.tenantId === 'b')!;
    expect(b.lastCompletedAt).toBeNull();
    // Not zero, and not a very large number: there is no silence to measure.
    expect(b.daysSinceLastCompleted).toBeNull();
  });

  it('orders the agenda longest-silence-first, then never-active orgs largest-first', async () => {
    await setup([
      org({
        tenantId: 'recent',
        tenantName: 'Recently active',
        lastCompletedAt: new Date('2024-06-11T00:00:00.000Z'),
      }),
      org({
        tenantId: 'never-small',
        tenantName: 'Never small',
        learners: 8,
        completedSimulations: 0,
        completedLast28d: 0,
        lastCompletedAt: null,
      }),
      org({
        tenantId: 'quiet',
        tenantName: 'Gone quiet',
        lastCompletedAt: new Date('2024-04-02T00:00:00.000Z'),
      }),
      org({
        tenantId: 'never-big',
        tenantName: 'Never big',
        learners: 40,
        completedSimulations: 0,
        completedLast28d: 0,
        lastCompletedAt: null,
      }),
    ]);

    const result = await service.getOrgHealth({});

    // Silence first (it is the churn signal), then the unstarted accounts by the
    // number of learners sitting behind an unused licence.
    expect(result.orgs.map((o) => o.tenantId)).toEqual([
      'quiet',
      'recent',
      'never-big',
      'never-small',
    ]);
  });

  it('leaves credit utilisation NULL when no limit is set, and flags the org as unset', async () => {
    await setup([
      org({
        tenantId: 'uncapped',
        creditLimit: 0,
        consumedCredits: 0,
        learnersWithCreditLimit: 0,
      }),
    ]);

    const result = await service.getOrgHealth({});

    const row = result.orgs[0];
    // "No limit configured" is not 0% utilisation — that would park every
    // unconfigured org at the comfortable end of the chart.
    expect(row.creditUtilisationPct).toBeNull();
    expect(row.creditsUnset).toBe(true);
    expect(row.creditLimit).toBe(0);
  });

  it('computes utilisation when a limit is set and the org clears the floor', async () => {
    await setup([org({ creditLimit: 200, consumedCredits: 50 })]);

    const result = await service.getOrgHealth({});

    expect(result.orgs[0].creditUtilisationPct).toBe(25);
    expect(result.orgs[0].creditsUnset).toBe(false);
    expect(result.orgs[0].belowFloor).toBe(false);
  });

  it('suppresses the rate for a below-floor org but keeps the row and every count', async () => {
    await setup([
      org({
        tenantId: 'tiny',
        learners: MIN_ORG_GROUP_SIZE - 1,
        activeLearners28d: 2,
        creditLimit: 10,
        consumedCredits: 9,
      }),
    ]);

    const result = await service.getOrgHealth({});

    const row = result.orgs[0];
    expect(row.belowFloor).toBe(true);
    // An account manager still has to see that the account exists and how big it is.
    expect(row.learners).toBe(MIN_ORG_GROUP_SIZE - 1);
    expect(row.activeLearners28d).toBe(2);
    expect(row.completedSimulations).toBe(100);
    expect(row.consumedCredits).toBe(9);
    // 90% over four learners describes four identifiable people.
    expect(row.creditUtilisationPct).toBeNull();
  });

  it('states the org population and derives dormant as its residual', async () => {
    await setup([
      org({
        tenantId: 'a',
        tenantName: 'A',
        learners: 20,
        completedLast28d: 3,
      }),
      org({
        tenantId: 'b',
        tenantName: 'B',
        learners: 5,
        completedLast28d: 0,
        lastCompletedAt: new Date('2024-01-05T00:00:00.000Z'),
      }),
      org({
        tenantId: 'c',
        tenantName: 'C',
        learners: 7,
        completedSimulations: 0,
        completedLast28d: 0,
        lastCompletedAt: null,
      }),
    ]);

    const result = await service.getOrgHealth({});

    expect(result.summary.orgs).toBe(3);
    expect(result.summary.activeOrgs).toBe(1);
    // The two always add up to the denominator printed beside them.
    expect(result.summary.dormantOrgs).toBe(2);
    expect(result.summary.learners).toBe(32);
  });

  it('asks for two equal 28-day periods, ending with today', async () => {
    await setup();

    await service.getOrgHealth({});

    const [last28Start, prev28Start] = repository.getOrgRows.mock.calls[0];
    // endExclusive is the start of tomorrow (2024-06-13), so the trailing window
    // is 2024-05-16 .. 2024-06-12 and its basis the 28 days before that.
    expect((last28Start as Date).toISOString()).toBe(
      '2024-05-16T00:00:00.000Z',
    );
    expect((prev28Start as Date).toISOString()).toBe(
      '2024-04-18T00:00:00.000Z',
    );
  });

  it('passes a trimmed tenant filter to both queries and echoes it in the scoping', async () => {
    await setup();

    const result = await service.getOrgHealth({ tenantId: '  ally  ' });

    expect(repository.getOrgRows).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'ally',
    );
    expect(repository.getWeeklyTrend).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'ally',
    );
    expect(result.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
  });
});
