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
    return new BugHunterMetricsService(
      findingRepository as never,
      runRepository as never,
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

  it('asks the repositories for the window it was given', async () => {
    const service = build([]);
    const metrics = await service.report(7);

    expect(metrics.windowDays).toBe(7);
    const since = new Date(metrics.since).getTime();
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(since - expected)).toBeLessThan(5_000);
  });
});
