import { BugHunterMetricsService } from '../bug-hunter-metrics.service';
import {
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';
import { FindingOutcomeCount } from '../../repository/bug-finding.repository';

/**
 * The arithmetic on this service is the whole product: the numbers it returns
 * are what decide whether Bug Hunter is allowed to widen its own autonomy. So
 * these cases are about the specific ways an accuracy figure lies, not about
 * plumbing.
 */
describe('BugHunterMetricsService', () => {
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

  const emptyLatency = {
    filedToMerged: { medianHours: null, p90Hours: null, sampled: 0 },
    mergedToReleased: { medianHours: null, p90Hours: null, sampled: 0 },
    filedToDecided: { medianHours: null, p90Hours: null, sampled: 0 },
  };

  const build = (
    rows: FindingOutcomeCount[],
    over: {
      regressions?: { regressions: number; regressedFixes: number };
      cost?: {
        costUsd: number;
        runs: number;
        fixSessionRuns: number;
        fixSessionCostUsd: number;
      };
      escalations?: { summary: string; count: number }[];
    } = {},
  ) => {
    const findingRepository = {
      outcomeCounts: jest.fn().mockResolvedValue(rows),
      stageLatencies: jest.fn().mockResolvedValue(emptyLatency),
      regressionCounts: jest
        .fn()
        .mockResolvedValue(
          over.regressions ?? { regressions: 0, regressedFixes: 0 },
        ),
    };
    const runRepository = {
      costInWindow: jest.fn().mockResolvedValue(
        over.cost ?? {
          costUsd: 0,
          runs: 0,
          fixSessionRuns: 0,
          fixSessionCostUsd: 0,
        },
      ),
    };
    const eventRepository = {
      escalationBreakdown: jest.fn().mockResolvedValue(over.escalations ?? []),
    };
    return new BugHunterMetricsService(
      findingRepository as never,
      runRepository as never,
      eventRepository as never,
    );
  };

  it('reports no accuracy at all when nothing has been judged', async () => {
    // The single most misleading number this endpoint could produce. A young
    // install has findings and no decisions, and printing "0% accurate" for it
    // would be read as the agent being wrong every time.
    const metrics = await build([row({ count: 12 })]).report(30);

    expect(metrics.overall.filed).toBe(12);
    expect(metrics.overall.accuracy).toBeNull();
    expect(metrics.overall.open).toBe(12);
  });

  it('counts only finder-error declines against accuracy', async () => {
    // Nine real-but-minor findings the team declined, one hallucination. A
    // team triaging well must not look like a broken agent.
    const metrics = await build([
      row({
        count: 9,
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.WONT_FIX,
      }),
      row({
        count: 1,
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.NOT_A_BUG,
      }),
    ]).report(30);

    expect(metrics.overall.finderErrors).toBe(1);
    expect(metrics.overall.accuracy).toBeCloseTo(0.9);
  });

  it('excludes declines with no recorded reason from the denominator', async () => {
    // Every row declined before the reason column existed. Folding them in
    // either direction invents data; the honest move is to name them and
    // divide by what is left.
    const metrics = await build([
      row({
        count: 5,
        status: BugFindingStatus.REJECTED,
        decisionReason: null,
      }),
      row({
        count: 1,
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.NOT_A_BUG,
      }),
      row({
        count: 1,
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.WONT_FIX,
      }),
    ]).report(30);

    expect(metrics.overall.reasonNotRecorded).toBe(5);
    // Judged = the two with reasons, not all seven.
    expect(metrics.overall.accuracy).toBeCloseTo(0.5);
    expect(
      metrics.declines.find((entry) => entry.reason === 'not_recorded')?.count,
    ).toBe(5);
  });

  it('keeps a released fix counted as merged', async () => {
    // Otherwise the merge figure FALLS every time something ships, and cost
    // per merged fix rises as the agent gets more successful.
    const metrics = await build([
      row({ count: 3, status: BugFindingStatus.MERGED }),
      row({ count: 2, status: BugFindingStatus.RELEASED }),
    ]).report(30);

    expect(metrics.overall.merged).toBe(5);
    expect(metrics.overall.released).toBe(2);
  });

  it('divides fix-session spend by fixes that actually landed', async () => {
    const metrics = await build(
      [row({ count: 4, status: BugFindingStatus.MERGED })],
      {
        cost: {
          costUsd: 60,
          runs: 20,
          fixSessionRuns: 8,
          fixSessionCostUsd: 40,
        },
      },
    ).report(30);

    expect(metrics.cost.perMergedFixUsd).toBe(10);
    expect(metrics.cost.totalUsd).toBe(60);
  });

  it('reports no cost-per-fix and no regression rate when nothing merged', async () => {
    const metrics = await build([row({ count: 4 })], {
      cost: { costUsd: 30, runs: 9, fixSessionRuns: 3, fixSessionCostUsd: 30 },
      regressions: { regressions: 1, regressedFixes: 0 },
    }).report(30);

    expect(metrics.cost.perMergedFixUsd).toBeNull();
    expect(metrics.regressions.rate).toBeNull();
    // The count itself is still reported: a regression filed against an older
    // fix is real news even in a window where nothing new merged.
    expect(metrics.regressions.filed).toBe(1);
  });

  it('groups repo-less findings as their own row rather than dropping them', async () => {
    // A human-reported bug has no repo until something triages it, and those
    // are precisely the rows worth seeing together.
    const metrics = await build([
      row({ count: 2, repo: null, source: BugFindingSource.REPORTED_BUG }),
      row({ count: 5, repo: 'ally-be' }),
    ]).report(30);

    const keys = metrics.byRepo.map((entry) => entry.key);
    expect(keys).toContain(null);
    expect(keys).toContain('ally-be');
    // Sorted by volume, so the busiest repo reads first.
    expect(metrics.byRepo[0].key).toBe('ally-be');
  });

  it('carries the low-confidence and unscored splits through', async () => {
    const metrics = await build([
      row({ count: 6, lowConfidence: 2, unscored: 1 }),
    ]).report(30);

    expect(metrics.overall.lowConfidence).toBe(2);
    expect(metrics.overall.unscored).toBe(1);
  });

  it('computes reversal rate as reversed over finder-error declines', async () => {
    const metrics = await build([
      row({
        count: 2,
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.NOT_A_BUG,
        reversed: 1,
      }),
    ]).report(30);

    expect(metrics.overall.finderErrors).toBe(2);
    expect(metrics.overall.reversed).toBe(1);
    expect(metrics.overall.reversalRate).toBeCloseTo(0.5);
  });

  it('reports no reversal rate when nothing was ever dismissed as a finder error', async () => {
    const metrics = await build([
      row({
        count: 3,
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.WONT_FIX,
      }),
    ]).report(30);

    expect(metrics.overall.finderErrors).toBe(0);
    expect(metrics.overall.reversalRate).toBeNull();
  });

  it('sums reversals per finder across multiple sources', async () => {
    const metrics = await build([
      row({
        count: 1,
        source: BugFindingSource.CODE_REVIEW,
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.DUPLICATE,
        reversed: 1,
      }),
      row({
        count: 1,
        source: BugFindingSource.TEST_FAILURE,
        status: BugFindingStatus.REJECTED,
        decisionReason: BugFindingDecisionReason.NOT_A_BUG,
        reversed: 0,
      }),
    ]).report(30);

    const codeReview = metrics.bySource.find(
      (entry) => entry.key === BugFindingSource.CODE_REVIEW,
    );
    const testFailure = metrics.bySource.find(
      (entry) => entry.key === BugFindingSource.TEST_FAILURE,
    );
    expect(codeReview?.reversalRate).toBe(1);
    expect(testFailure?.reversalRate).toBe(0);
  });

  it('passes the escalation breakdown through untouched', async () => {
    const escalations = [
      { summary: 'suite still red after the attempt cap', count: 4 },
      { summary: 'asked the admin an open product question', count: 1 },
    ];
    const service = build([], { escalations });

    const metrics = await service.report(30);

    expect(metrics.escalations).toEqual(escalations);
  });

  it('asks the repositories for the window it was given', async () => {
    const service = build([]);
    const metrics = await service.report(7);

    expect(metrics.windowDays).toBe(7);
    const since = new Date(metrics.since).getTime();
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(since - expected)).toBeLessThan(5_000);
  });
});

import { buildOperations, difficultyOf } from '../bug-hunter-metrics.service';
import { BugHuntTrigger } from '../../enum/bug-hunt-run.enum';

/**
 * The operations view is volume paired with what became of it. These cases
 * are about the two ways a volume chart lies: dropping quiet days, and
 * showing a count with no acceptance figure beside it.
 */
describe('buildOperations', () => {
  const now = new Date('2026-09-28T12:00:00.000Z');
  const since = new Date('2026-09-26T12:00:00.000Z');

  it('draws every calendar day in the window, zeros included, oldest first', () => {
    const out = buildOperations(3, since, [], [], [], [], now);
    expect(out.days.map((d) => d.date)).toEqual([
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
    ]);
    expect(out.days[1]).toMatchObject({ filed: 0, accepted: 0, bySource: {} });
    expect(out.days[1].tokens[BugHuntTrigger.SCHEDULED]).toEqual({
      runs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    });
  });

  it("pairs each day's volume with where that cohort stands now, and sums sources", () => {
    const out = buildOperations(
      3,
      since,
      [
        {
          day: '2026-09-27',
          source: BugFindingSource.CODE_REVIEW,
          proven: false,
          filed: 5,
          accepted: 2,
          declined: 2,
          undecided: 1,
        },
        {
          day: '2026-09-27',
          source: BugFindingSource.TEST_FAILURE,
          proven: true,
          filed: 1,
          accepted: 1,
          declined: 0,
          undecided: 0,
        },
        {
          day: '2026-09-28',
          source: BugFindingSource.CODE_REVIEW,
          proven: false,
          filed: 2,
          accepted: 0,
          declined: 0,
          undecided: 2,
        },
      ],
      [],
      [],
      [],
      now,
    );

    const day = out.days.find((d) => d.date === '2026-09-27')!;
    expect(day).toMatchObject({
      filed: 6,
      accepted: 3,
      declined: 2,
      undecided: 1,
      bySource: { code_review: 5, test_failure: 1 },
    });
    // Most filed first, so the legend order is the order that matters.
    expect(out.bySource.map((s) => s.source)).toEqual([
      BugFindingSource.CODE_REVIEW,
      BugFindingSource.TEST_FAILURE,
    ]);
    expect(out.bySource[0]).toMatchObject({
      filed: 7,
      accepted: 2,
      declined: 2,
    });
    expect(out.totals).toMatchObject({
      filed: 8,
      accepted: 3,
      declined: 2,
      undecided: 3,
    });
  });

  it('splits filed bugs into easy / hard / reported from proven + source, never from a stored label', () => {
    expect(difficultyOf(BugFindingSource.TEST_FAILURE, true)).toBe('easy');
    expect(difficultyOf(BugFindingSource.PRODUCTION_LOG, true)).toBe('easy');
    expect(difficultyOf(BugFindingSource.CODE_REVIEW, false)).toBe('hard');
    expect(difficultyOf(BugFindingSource.UX_SIGNAL, false)).toBe('hard');
    // A person spotted it, whatever the finder later proved.
    expect(difficultyOf(BugFindingSource.REPORTED_BUG, false)).toBe('reported');
    expect(difficultyOf(BugFindingSource.REPORTED_BUG, true)).toBe('reported');

    const out = buildOperations(
      3,
      since,
      [
        {
          day: '2026-09-27',
          source: BugFindingSource.CODE_REVIEW,
          proven: false,
          filed: 4,
          accepted: 1,
          declined: 2,
          undecided: 1,
        },
        {
          day: '2026-09-27',
          source: BugFindingSource.LINT_ERROR,
          proven: true,
          filed: 3,
          accepted: 3,
          declined: 0,
          undecided: 0,
        },
        {
          day: '2026-09-28',
          source: BugFindingSource.REPORTED_BUG,
          proven: false,
          filed: 2,
          accepted: 0,
          declined: 0,
          undecided: 2,
        },
      ],
      [],
      [],
      [],
      now,
    );
    const day = out.days.find((d) => d.date === '2026-09-27')!;
    expect(day.byDifficulty.easy).toEqual({
      filed: 3,
      accepted: 3,
      declined: 0,
      undecided: 0,
    });
    expect(day.byDifficulty.hard.filed).toBe(4);
    expect(day.byDifficulty.reported.filed).toBe(0);
    // Always all three, in a fixed order, so the chart's legend never reshuffles.
    expect(out.byDifficulty.map((d) => d.difficulty)).toEqual([
      'easy',
      'hard',
      'reported',
    ]);
    expect(out.byDifficulty[2]).toMatchObject({ filed: 2, undecided: 2 });
  });

  it('always reports all three reporters, so a zero for consumers is visible rather than missing', () => {
    const out = buildOperations(
      3,
      since,
      [],
      [{ reporter: 'agent', filed: 9, accepted: 4, declined: 3 }],
      [],
      [],
      now,
    );
    expect(out.byReporter).toEqual([
      { reporter: 'agent', filed: 9, accepted: 4, declined: 3 },
      { reporter: 'staff', filed: 0, accepted: 0, declined: 0 },
      { reporter: 'consumer', filed: 0, accepted: 0, declined: 0 },
    ]);
  });

  it('buckets tokens by day and trigger, rounds cost to cents, and ranks models by tokens', () => {
    const out = buildOperations(
      3,
      since,
      [],
      [],
      [
        {
          day: '2026-09-27',
          trigger: BugHuntTrigger.SCHEDULED,
          runs: 2,
          inputTokens: 1000,
          outputTokens: 200,
          costUsd: 0.12345,
          breadthRuns: 2,
          linesInScope: 4200,
          filesInScope: 31,
          commits: 6,
          deepRuns: 0,
        },
        {
          day: '2026-09-27',
          trigger: BugHuntTrigger.FIX_SESSION,
          runs: 1,
          inputTokens: 300,
          outputTokens: 50,
          costUsd: 0.05,
          breadthRuns: 0,
          linesInScope: 0,
          filesInScope: 0,
          commits: 0,
          deepRuns: 0,
        },
        // Outside the axis (clock skew): dropped, not drawn on a phantom day.
        {
          day: '2026-10-01',
          trigger: BugHuntTrigger.MANUAL,
          runs: 1,
          inputTokens: 999,
          outputTokens: 999,
          costUsd: 9,
          breadthRuns: 1,
          linesInScope: 100,
          filesInScope: 1,
          commits: 1,
          deepRuns: 1,
        },
      ],
      [
        {
          model: 'claude-sonnet-5',
          provider: 'anthropic',
          runs: 3,
          inputTokens: 800,
          outputTokens: 100,
          cacheReadTokens: 500,
        },
        {
          model: 'claude-opus-5',
          provider: 'anthropic',
          runs: 1,
          inputTokens: 5000,
          outputTokens: 400,
          cacheReadTokens: 0,
        },
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
    expect(day.tokens[BugHuntTrigger.FIX_SESSION].inputTokens).toBe(300);
    expect(out.days.some((d) => d.date === '2026-10-01')).toBe(false);
    // Breadth comes only from runs that reported it; the fix session did not,
    // so the day's breadth is the two sweeps' alone.
    expect(day.breadth).toEqual({
      runs: 2,
      linesInScope: 4200,
      filesInScope: 31,
      commits: 6,
      deepRuns: 0,
    });
    // A day with runs but no breadth is "not recorded", never zero.
    expect(out.days.find((d) => d.date === '2026-09-26')!.breadth).toBeNull();
    // The window total does include the skewed row's real run.
    expect(out.breadth).toMatchObject({
      runs: 3,
      linesInScope: 4300,
      deepRuns: 1,
    });
    expect(out.tokensByModel.map((m) => m.model)).toEqual([
      'claude-opus-5',
      'claude-sonnet-5',
    ]);
    // Totals include the skewed row's spend? No — it is a real run, so its
    // tokens count in the window total even though no day draws it.
    expect(out.totals).toMatchObject({
      inputTokens: 2299,
      outputTokens: 1249,
      runs: 4,
      costUsd: 9.17,
    });
  });

  it('is what the service returns from the four repository reads', async () => {
    const findingRepository = {
      outcomeCounts: jest.fn(),
      stageLatencies: jest.fn(),
      regressionCounts: jest.fn(),
      dailyFiledCounts: jest.fn().mockResolvedValue([]),
      reporterCounts: jest.fn().mockResolvedValue([]),
    };
    const runRepository = {
      costInWindow: jest.fn(),
      dailyTokens: jest.fn().mockResolvedValue([]),
      tokensByModel: jest.fn().mockResolvedValue([]),
    };
    const service = new BugHunterMetricsService(
      findingRepository as never,
      runRepository as never,
      { escalationBreakdown: jest.fn() } as never,
    );

    const out = await service.operations(7);

    expect(out.windowDays).toBe(7);
    expect(out.days).toHaveLength(8);
    expect(findingRepository.dailyFiledCounts).toHaveBeenCalledWith(
      expect.any(Date),
    );
    expect(runRepository.tokensByModel).toHaveBeenCalledWith(expect.any(Date));
  });
});
