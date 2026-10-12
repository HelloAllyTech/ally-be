import {
  BugHunterMetricsService,
  buildOperations,
  foldFunnel,
  groupFunnels,
} from '../bug-hunter-metrics.service';
import {
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';
import {
  DailyFiledCount,
  FindingOutcomeCount,
} from '../../repository/bug-finding.repository';
import { DailyRunTokens } from '../../repository/bug-hunt-run.repository';
import { BugHuntTrigger } from '../../enum/bug-hunt-run.enum';

/**
 * The funnel arithmetic is what the weekly precision figures on Analytics →
 * Bug Agent stand on, so these cases are about the specific ways an accuracy
 * figure lies, not about plumbing. The whole-window report that used to sit
 * on this service went with the accuracy panel (2026-10-12); the arithmetic
 * stayed, exported, and is tested here directly.
 */
describe('funnel arithmetic', () => {
  const row = (
    over: Partial<FindingOutcomeCount> & { count: number },
  ): FindingOutcomeCount => ({
    source: BugFindingSource.CODE_REVIEW,
    repo: 'ally-web',
    status: BugFindingStatus.NEW,
    decisionReason: null,
    lowConfidence: 0,
    unscored: 0,
    reversed: 0,
    ...over,
  });

  it('reports no accuracy at all when nothing has been judged', () => {
    const funnel = foldFunnel('all', [row({ count: 4 })]);
    expect(funnel.filed).toBe(4);
    expect(funnel.open).toBe(4);
    expect(funnel.accuracy).toBeNull();
    expect(funnel.reversalRate).toBeNull();
  });

  it('counts only finder-error declines against accuracy', () => {
    const funnel = foldFunnel('all', [
      row({
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.NOT_A_BUG,
        count: 1,
      }),
      row({
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.WONT_FIX,
        count: 2,
      }),
      row({ status: BugFindingStatus.MERGED, count: 2 }),
    ]);
    // judged = 3 declined with a reason + 2 approved (merged) = 5; 1 finder error
    expect(funnel.finderErrors).toBe(1);
    expect(funnel.approved).toBe(2);
    expect(funnel.accuracy).toBeCloseTo(1 - 1 / 5);
  });

  it('excludes declines with no recorded reason from the denominator', () => {
    const funnel = foldFunnel('all', [
      row({ status: BugFindingStatus.DISMISSED, count: 3 }),
      row({
        status: BugFindingStatus.DISMISSED,
        decisionReason: BugFindingDecisionReason.DUPLICATE,
        count: 1,
      }),
    ]);
    expect(funnel.reasonNotRecorded).toBe(3);
    expect(funnel.accuracy).toBe(0);
  });

  it('keeps a released fix counted as merged, and reversals as a rate over finder errors', () => {
    const funnel = foldFunnel('all', [
      row({ status: BugFindingStatus.RELEASED, count: 2 }),
      row({
        status: BugFindingStatus.DISMISSED,
        decisionReason: BugFindingDecisionReason.NOT_A_BUG,
        reversed: 1,
        count: 2,
      }),
    ]);
    expect(funnel.merged).toBe(2);
    expect(funnel.released).toBe(2);
    expect(funnel.reversalRate).toBe(0.5);
  });

  it('groups repo-less findings as their own row rather than dropping them, most filed first', () => {
    const funnels = groupFunnels(
      [
        row({ repo: null, source: BugFindingSource.REPORTED_BUG, count: 1 }),
        row({ repo: 'ally-be', count: 3 }),
      ],
      (r) => r.repo,
    );
    expect(funnels.map((f) => [f.key, f.filed])).toEqual([
      ['ally-be', 3],
      [null, 1],
    ]);
  });
});

describe('buildOperations', () => {
  const now = new Date('2026-09-28T12:00:00.000Z');
  const since = new Date('2026-09-26T12:00:00.000Z');
  const cell = (
    day: string,
    counts: [number, number, number, number],
    source = BugFindingSource.CODE_REVIEW,
  ): DailyFiledCount => ({
    day,
    source,
    proven: false,
    filed: counts[0],
    accepted: counts[1],
    declined: counts[2],
    undecided: counts[3],
  });

  it('draws every calendar day in the window, zeros included, oldest first', () => {
    const out = buildOperations(3, since, [], [], now);
    expect(out.days.map((d) => d.date)).toEqual([
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
    ]);
    expect(out.days[1]).toMatchObject({
      date: '2026-09-27',
      filed: 0,
      accepted: 0,
      declined: 0,
      undecided: 0,
    });
    expect(out.days[1].tokens[BugHuntTrigger.SCHEDULED]).toEqual({
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
    expect(out.totals).toEqual({
      filed: 0,
      accepted: 0,
      declined: 0,
      undecided: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      runs: 0,
    });
  });

  it("pairs each day's volume with where that cohort stands now, summing the repository's per-source cells", () => {
    const out = buildOperations(
      3,
      since,
      [
        cell('2026-09-27', [5, 2, 2, 1]),
        cell('2026-09-27', [1, 1, 0, 0], BugFindingSource.TEST_FAILURE),
        cell('2026-09-28', [2, 0, 0, 2]),
        // Outside the axis: not drawn, but still in the window totals.
        cell('2026-09-30', [1, 0, 1, 0]),
      ],
      [],
      now,
    );
    expect(out.days[1]).toMatchObject({
      date: '2026-09-27',
      filed: 6,
      accepted: 3,
      declined: 2,
      undecided: 1,
    });
    expect(out.days[2].filed).toBe(2);
    expect(out.totals).toMatchObject({
      filed: 9,
      accepted: 3,
      declined: 3,
      undecided: 3,
    });
    expect(out.windowDays).toBe(3);
    expect(out.since).toBe(since.toISOString());
  });

  it('buckets spend by day and trigger, rounds cost to cents, and counts an off-axis run in the totals', () => {
    const spend = (
      day: string,
      trigger: BugHuntTrigger,
      over: Partial<DailyRunTokens> = {},
    ): DailyRunTokens => ({
      day,
      trigger,
      runs: 1,
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.12345,
      ...over,
    });
    const out = buildOperations(
      3,
      since,
      [],
      [
        spend('2026-09-27', BugHuntTrigger.SCHEDULED, { runs: 2 }),
        spend('2026-09-27', BugHuntTrigger.FIX_SESSION, {
          inputTokens: 300,
          outputTokens: 50,
          costUsd: 1.25,
        }),
        // A run stamped after the axis ends: real spend, no bar.
        spend('2026-10-01', BugHuntTrigger.MANUAL, { costUsd: 9 }),
      ],
      now,
    );
    const day = out.days.find((d) => d.date === '2026-09-27')!;
    expect(day.tokens[BugHuntTrigger.SCHEDULED]).toEqual({
      runs: 2,
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.12,
    });
    expect(day.tokens[BugHuntTrigger.FIX_SESSION].costUsd).toBe(1.25);
    expect(day.tokens[BugHuntTrigger.PR_REVIEW].runs).toBe(0);
    expect(out.days.some((d) => d.date === '2026-10-01')).toBe(false);
    expect(out.totals).toMatchObject({
      inputTokens: 2300,
      outputTokens: 450,
      runs: 4,
      costUsd: 10.37,
    });
  });

  it('is what the service returns from the two repository reads', async () => {
    const findingRepository = {
      dailyFiledCounts: jest.fn().mockResolvedValue([]),
    };
    const runRepository = { dailyTokens: jest.fn().mockResolvedValue([]) };
    const service = new BugHunterMetricsService(
      findingRepository as never,
      runRepository as never,
    );

    const out = await service.operations(7);

    expect(out.windowDays).toBe(7);
    expect(out.days).toHaveLength(8);
    expect(findingRepository.dailyFiledCounts).toHaveBeenCalledWith(
      expect.any(Date),
    );
    expect(runRepository.dailyTokens).toHaveBeenCalledWith(expect.any(Date));
  });
});
