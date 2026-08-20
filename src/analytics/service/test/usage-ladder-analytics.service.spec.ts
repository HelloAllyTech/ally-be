import { Test, TestingModule } from '@nestjs/testing';

import { UsageLadderAnalyticsService } from '../usage-ladder-analytics.service';
import {
  USAGE_LADDER_LEVELS,
  USAGE_LADDER_MIN_PERIODS,
  UsageLadderAnalyticsRepository,
  UsageLadderFunnelRow,
  UsageLadderPeriodRow,
} from '../../repository/usage-ladder-analytics.repository';

/**
 * Fixed "now" = 2024-06-12, so the current month is 2024-06 (a minimum-span
 * monthly axis runs 2023-07..2024-06) and the current quarter is 2024-04.
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

const LEVELS = USAGE_LADDER_LEVELS.length;

const zeros = () => Array<number>(LEVELS).fill(0);

/** `Array.prototype.at` is beyond this project's lib target. */
const last = <T>(items: T[]): T | undefined => items[items.length - 1];
const nthFromEnd = <T>(items: T[], n: number): T | undefined =>
  items[items.length - n];

const period = (
  periodStart: string,
  newlyReachedByLevel: number[],
): UsageLadderPeriodRow => ({ period: periodStart, newlyReachedByLevel });

const funnel = (
  overrides: Partial<UsageLadderFunnelRow> = {},
): UsageLadderFunnelRow => ({
  accounts: 0,
  everReachedByLevel: zeros(),
  ...overrides,
});

describe('UsageLadderAnalyticsService', () => {
  let service: UsageLadderAnalyticsService;

  const setup = async (
    periodRows: UsageLadderPeriodRow[] = [],
    funnelRow: UsageLadderFunnelRow = funnel(),
    firstActivityPeriod: string | null = null,
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageLadderAnalyticsService,
        {
          provide: UsageLadderAnalyticsRepository,
          useValue: {
            getAttainmentByPeriod: jest.fn().mockResolvedValue(periodRows),
            getFunnel: jest.fn().mockResolvedValue(funnelRow),
            getFirstActivityPeriod: jest
              .fn()
              .mockResolvedValue(firstActivityPeriod),
          },
        },
      ],
    }).compile();

    service = module.get(UsageLadderAnalyticsService);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the axis', () => {
    it('spans the minimum number of months when the platform is empty', async () => {
      await setup();
      const result = await service.getUsageLadder({});

      expect(result.periods).toHaveLength(USAGE_LADDER_MIN_PERIODS.month);
      expect(result.periods[0].period).toBe('2023-07-01');
      expect(last(result.periods)?.period).toBe('2024-06-01');
    });

    it('reaches back to the first practice period when that is earlier', async () => {
      await setup([], funnel(), '2022-01-01');
      const result = await service.getUsageLadder({});

      expect(result.periods[0].period).toBe('2022-01-01');
      expect(last(result.periods)?.period).toBe('2024-06-01');
    });

    it('is contiguous, gap-filling quiet periods with real zeros', async () => {
      await setup(
        [period('2024-05-01', [3, 1, 0, 0, 0])],
        funnel(),
        '2024-03-01',
      );
      const result = await service.getUsageLadder({});

      // Nothing crossed in April; it must still be on the axis.
      const april = result.periods.find((p) => p.period === '2024-04-01');
      expect(april?.newlyReached).toEqual(zeros());
    });

    it('steps by quarter, over a shorter minimum span, at quarter grain', async () => {
      await setup();
      const result = await service.getUsageLadder({ grain: 'quarter' });

      expect(result.grain).toBe('quarter');
      expect(result.periods).toHaveLength(USAGE_LADDER_MIN_PERIODS.quarter);
      expect(last(result.periods)?.period).toBe('2024-04-01');
      expect(nthFromEnd(result.periods, 2)?.period).toBe('2024-01-01');
    });

    it('flags only the period containing today as partial', async () => {
      await setup();
      const result = await service.getUsageLadder({});

      expect(result.periods.filter((p) => p.partial)).toHaveLength(1);
      expect(last(result.periods)?.partial).toBe(true);
      expect(result.currentPeriod).toBe('2024-06-01');
    });
  });

  describe('the cumulative series', () => {
    it('is the running total of the crossings and never falls', async () => {
      await setup(
        [
          period('2024-03-01', [5, 0, 0, 0, 0]),
          period('2024-04-01', [2, 1, 0, 0, 0]),
        ],
        funnel(),
        '2024-03-01',
      );
      const result = await service.getUsageLadder({});
      const byPeriod = new Map(result.periods.map((p) => [p.period, p]));

      expect(byPeriod.get('2024-03-01')?.cumulative[0]).toBe(5);
      expect(byPeriod.get('2024-04-01')?.cumulative[0]).toBe(7);
      // A quiet period holds the level rather than dropping to zero.
      expect(byPeriod.get('2024-05-01')?.cumulative[0]).toBe(7);
      expect(byPeriod.get('2024-06-01')?.cumulative[1]).toBe(1);

      const l1 = result.periods.map((p) => p.cumulative[0]);
      expect(l1).toEqual([...l1].sort((a, b) => a - b));
    });

    it('never leaves a crossing off the left of the axis', async () => {
      // An old crossing with no other reason to extend the axis. The minimum
      // span alone would start at 2023-07 and drop this bar, while the
      // cumulative line would still be counting the learner — so the axis
      // stretches back instead. This is what keeps the two series consistent.
      await setup([period('2020-01-01', [4, 0, 0, 0, 0])], funnel());
      const result = await service.getUsageLadder({});

      expect(result.periods[0].period).toBe('2020-01-01');
      expect(result.periods[0].newlyReached[0]).toBe(4);
      expect(result.periods[0].cumulative[0]).toBe(4);
      // And it stays counted for the rest of the axis.
      expect(last(result.periods)?.cumulative[0]).toBe(4);
    });

    it('does not share array identity between periods', async () => {
      await setup(
        [period('2024-04-01', [1, 0, 0, 0, 0])],
        funnel(),
        '2024-01-01',
      );
      const result = await service.getUsageLadder({});

      // A single mutated accumulator leaked into every period would make the
      // whole series read as the final value.
      expect(result.periods[0].cumulative).not.toBe(
        result.periods[1].cumulative,
      );
      expect(result.periods[0].cumulative[0]).toBe(0);
    });
  });

  describe('the funnel', () => {
    it('nests, and states both conversions', async () => {
      await setup(
        [],
        funnel({ accounts: 200, everReachedByLevel: [100, 50, 20, 5, 1] }),
      );
      const result = await service.getUsageLadder({});

      expect(result.funnel.map((s) => s.id)).toEqual([
        'accounts',
        ...USAGE_LADDER_LEVELS.map((l) => l.id),
      ]);
      expect(result.funnel.map((s) => s.learners)).toEqual([
        200, 100, 50, 20, 5, 1,
      ]);

      const l1 = result.funnel[1];
      expect(l1.ofTopPct).toBe(50);
      expect(l1.ofPreviousPct).toBe(50);

      const l2 = result.funnel[2];
      expect(l2.ofTopPct).toBe(25);
      // 50 of the 100 who reached L1 — the number that says where people are lost.
      expect(l2.ofPreviousPct).toBe(50);
    });

    it('nulls conversions over a zero denominator rather than reporting 0%', async () => {
      await setup([], funnel({ accounts: 0, everReachedByLevel: zeros() }));
      const result = await service.getUsageLadder({});

      expect(result.funnel[0].ofTopPct).toBeNull();
      expect(result.funnel[1].ofTopPct).toBeNull();
      expect(result.funnel[1].ofPreviousPct).toBeNull();
    });

    it('has no conversion on its top row', async () => {
      await setup([], funnel({ accounts: 10 }));
      const result = await service.getUsageLadder({});

      expect(result.funnel[0].ofPreviousPct).toBeNull();
      expect(result.funnel[0].ofTopPct).toBe(100);
    });
  });

  it('echoes the ladder and the certification threshold it is NOT', async () => {
    await setup();
    const result = await service.getUsageLadder({});

    expect(result.levels).toEqual(USAGE_LADDER_LEVELS);
    // Present so a surface can caption the relationship; the two are separate
    // scales and this must never be treated as a rung.
    expect(result.certificationMinMinutes).toBe(5000);
    expect(result.levels.map((l) => l.minMinutes)).not.toContain(
      result.certificationMinMinutes,
    );
  });
});
