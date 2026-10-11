import { Injectable } from '@nestjs/common';

import { BugFindingRepository } from 'src/bug-hunter/repository/bug-finding.repository';
import { BugHuntRunRepository } from 'src/bug-hunter/repository/bug-hunt-run.repository';
import { BugHuntEventRepository } from 'src/bug-hunter/repository/bug-hunt-event.repository';
import {
  foldFunnel,
  groupFunnels,
} from 'src/bug-hunter/service/bug-hunter-metrics.service';

import {
  BugAgentGoalDto,
  BugAgentPerformanceQueryDto,
  BugAgentPerformanceResponseDto,
  CostWeekDto,
  GoalWeekDto,
  FoundDayDto,
  PrecisionWeekDto,
  ReliabilityWeekDto,
  SpeedWeekDto,
  ThroughputWeekDto,
} from '../dto/bug-agent-performance-analytics.dto';
import {
  describeWindow,
  generateBucketLabels,
  isoDate,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';
import { Between, In } from 'typeorm';

const defaultBucketFor = () => 'week' as const;

/** Null when the denominator is zero — a rate over nothing is not zero, it is unmeasured. */
const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

/** Days the "bugs found per day" trailing mean looks back over, itself included. */
export const FOUND_ROLLING_DAYS = 7;

/**
 * One point per UTC day in the window, zero-filled, with a trailing
 * seven-day mean. Exported so the spec can pin the arithmetic without a
 * module to compile; the window's own daily series is what the Bug Agent
 * tab plots to show the count going down.
 */
export const buildFoundSeries = (
  days: string[],
  filedByDay: Map<string, number>,
): FoundDayDto[] => {
  const filed = days.map((day) => filedByDay.get(day) ?? 0);
  return days.map((day, index) => {
    const windowStart = index - (FOUND_ROLLING_DAYS - 1);
    const rollingAvg7 =
      windowStart < 0
        ? null
        : round(
            filed
              .slice(windowStart, index + 1)
              .reduce((sum, value) => sum + value, 0) / FOUND_ROLLING_DAYS,
          );
    return { day, filed: filed[index], rollingAvg7 };
  });
};

/**
 * Bug Agent Performance: the five headline trends (precision, fix throughput,
 * speed, cost, reliability) behind the new Analytics tab, all bucketed by
 * calendar week.
 *
 * Deliberately reads `BugFindingRepository`/`BugHuntRunRepository`/
 * `BugHuntEventRepository` directly rather than adding a dedicated
 * `bug-agent-performance-analytics.repository.ts`: every underlying query is
 * a bucketed sibling of a method those repositories already own
 * (`outcomeCounts`, `costInWindow`, `escalationBreakdown`), so the SQL lives
 * next to what it's a variant of instead of a second copy elsewhere. The
 * three repositories are provided directly in `AnalyticsModule` rather than
 * importing the whole `BugHunterModule` — same reasoning as this week's
 * `PosthogQueryService`/`BugHunterRepoClassifierService` additions: they
 * construct themselves from the DataSource alone, so this costs nothing and
 * avoids pulling in Bug Hunter's full service graph for three read queries.
 *
 * `foldFunnel`/`groupFunnels` are reused, not reimplemented: folding a week's
 * `WeeklyFindingOutcomeCount` rows into a `FindingFunnel` is the identical
 * arithmetic `BugHunterMetricsService` already uses for a whole window — the
 * row shape only adds a `week` field neither function reads.
 */
@Injectable()
export class BugAgentPerformanceAnalyticsService {
  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly runRepository: BugHuntRunRepository,
    private readonly eventRepository: BugHuntEventRepository,
  ) {}

  async getPerformance(
    query: BugAgentPerformanceQueryDto,
  ): Promise<BugAgentPerformanceResponseDto> {
    const needsFloor =
      (query.range ?? 'all') === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '90d',
      defaultBucketFor,
      allTimeStart: needsFloor
        ? await this.runRepository.getDataFloor()
        : undefined,
    });
    const { start, endExclusive } = window;
    // This chart is inherently weekly regardless of what bucket the shared
    // window resolver picked for `window.bucket` (echoed to the client as-is)
    // — every query below truncs to week itself.
    const weeks = generateBucketLabels(start, endExclusive, 'week');
    // The one exception to "inherently weekly": the found-per-day series,
    // whose whole point is a daily grain — see `dailyFiledTotals`.
    const days = generateBucketLabels(start, endExclusive, 'day');

    const [
      outcomeRows,
      regressionRows,
      queueRows,
      stageLatencyRows,
      runRows,
      escalationRows,
      fallbackRows,
      filedRows,
    ] = await Promise.all([
      this.findingRepository.weeklyOutcomeCounts(start, endExclusive),
      this.findingRepository.weeklyRegressionCounts(start, endExclusive),
      this.findingRepository.weeklyQueueToStartLatency(start, endExclusive),
      this.findingRepository.weeklyStageLatencies(start, endExclusive),
      this.runRepository.weeklyRunStats(start, endExclusive),
      this.eventRepository.weeklyEscalationCounts(start, endExclusive),
      this.eventRepository.weeklyFallbackCounts(start, endExclusive),
      this.findingRepository.dailyFiledTotals(start, endExclusive),
    ]);

    const byWeek = <T extends { week: Date }>(rows: T[]): Map<string, T[]> => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const key = isoDate(row.week);
        const group = map.get(key) ?? [];
        group.push(row);
        map.set(key, group);
      }
      return map;
    };

    const outcomeByWeek = byWeek(outcomeRows);
    const regressionByWeek = byWeek(regressionRows);
    const queueByWeek = byWeek(queueRows);
    const stageLatencyByWeek = byWeek(stageLatencyRows);
    const runByWeek = byWeek(runRows);
    const escalationByWeek = byWeek(escalationRows);
    const fallbackByWeek = byWeek(fallbackRows);

    const precisionWeekly: PrecisionWeekDto[] = weeks.map((week) => {
      const funnel = foldFunnel(week, outcomeByWeek.get(week) ?? []);
      const judged =
        Math.max(
          0,
          funnel.dismissed + funnel.rejected - funnel.reasonNotRecorded,
        ) + funnel.approved;
      return {
        week,
        accuracy: funnel.accuracy,
        reversalRate: funnel.reversalRate,
        filed: funnel.filed,
        judged,
      };
    });

    const bySource = groupFunnels(outcomeRows, (row) => row.source).map((f) => {
      const judged =
        Math.max(0, f.dismissed + f.rejected - f.reasonNotRecorded) +
        f.approved;
      return {
        source: f.key ?? 'unknown',
        accuracy: f.accuracy,
        filed: f.filed,
        judged,
      };
    });

    const throughputWeekly: ThroughputWeekDto[] = weeks.map((week) => {
      const funnel = foldFunnel(week, outcomeByWeek.get(week) ?? []);
      const runsThisWeek = runByWeek.get(week) ?? [];
      const fixSessionRuns = runsThisWeek
        .filter((r) => r.trigger === 'fix_session')
        .reduce((sum, r) => sum + r.runs, 0);
      const escalations = (escalationByWeek.get(week) ?? []).reduce(
        (sum, r) => sum + r.count,
        0,
      );
      const fallbacks = (fallbackByWeek.get(week) ?? []).reduce(
        (sum, r) => sum + r.count,
        0,
      );
      return {
        week,
        approvedToMergedRate: rate(funnel.merged, funnel.approved),
        escalationRate: rate(escalations, fixSessionRuns),
        fallbackRate: rate(fallbacks, fixSessionRuns),
        approved: funnel.approved,
        merged: funnel.merged,
        fixSessionRuns,
        escalations,
        fallbacks,
      };
    });

    const speedWeekly: SpeedWeekDto[] = weeks.map((week) => {
      const queue = (queueByWeek.get(week) ?? [])[0];
      const stage = (stageLatencyByWeek.get(week) ?? [])[0];
      return {
        week,
        filedToDecidedMedianHours: stage?.filedToDecided.medianHours ?? null,
        filedToMergedMedianHours: stage?.filedToMerged.medianHours ?? null,
        mergedToReleasedMedianHours:
          stage?.mergedToReleased.medianHours ?? null,
        queueToStartMedianHours: queue?.medianHours ?? null,
      };
    });

    const costWeekly: CostWeekDto[] = weeks.map((week) => {
      const funnel = foldFunnel(week, outcomeByWeek.get(week) ?? []);
      const totalUsd = (runByWeek.get(week) ?? []).reduce(
        (sum, r) => sum + r.costUsd,
        0,
      );
      const fixSessionUsd = (runByWeek.get(week) ?? [])
        .filter((r) => r.trigger === 'fix_session')
        .reduce((sum, r) => sum + r.costUsd, 0);
      return {
        week,
        totalUsd: round(totalUsd),
        costPerMergedFixUsd:
          funnel.merged === 0 ? null : round(fixSessionUsd / funnel.merged),
        merged: funnel.merged,
      };
    });

    const reliabilityWeekly: ReliabilityWeekDto[] = weeks.map((week) => {
      const runsThisWeek = runByWeek.get(week) ?? [];
      const runs = runsThisWeek.reduce((sum, r) => sum + r.runs, 0);
      const completed = runsThisWeek
        .filter((r) => r.status === 'completed')
        .reduce((sum, r) => sum + r.runs, 0);
      const failed = runsThisWeek
        .filter((r) => r.status === 'failed')
        .reduce((sum, r) => sum + r.runs, 0);
      const fixSessionRuns = runsThisWeek
        .filter((r) => r.trigger === 'fix_session')
        .reduce((sum, r) => sum + r.runs, 0);
      const fallbacks = (fallbackByWeek.get(week) ?? []).reduce(
        (sum, r) => sum + r.count,
        0,
      );
      const regression = (regressionByWeek.get(week) ?? [])[0];
      const funnel = foldFunnel(week, outcomeByWeek.get(week) ?? []);
      return {
        week,
        completionRate: rate(completed, completed + failed),
        fallbackRate: rate(fallbacks, fixSessionRuns),
        regressionRate: rate(regression?.regressedFixes ?? 0, funnel.merged),
        runs,
        completed,
        failed,
      };
    });

    const found = buildFoundSeries(
      days,
      new Map(filedRows.map((row) => [isoDate(row.day), row.filed])),
    );

    const goal = await this.goal(start, endExclusive, weeks);

    return {
      goal,
      precision: { weekly: precisionWeekly, bySource },
      throughput: throughputWeekly,
      speed: speedWeekly,
      cost: costWeekly,
      reliability: reliabilityWeekly,
      found,
      window: describeWindow(window),
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * The goal numbers (OPP-0778) — see `GoalWeekDto`. Computed from the rows
   * in the window rather than a new aggregate: a few hundred findings, the
   * completed sweeps of the window plus the week before it (for the escape
   * look-back), and the merge events of the window.
   */
  private async goal(
    start: Date,
    endExclusive: Date,
    weeks: string[],
  ): Promise<BugAgentGoalDto> {
    const lookbackStart = new Date(start.getTime() - ESCAPE_LOOKBACK_MS);
    const [findings, sweeps, mergeEvents] = await Promise.all([
      this.findingRepository.find({
        where: { createdAt: Between(start, endExclusive) },
        select: [
          'id',
          'repo',
          'source',
          'status',
          'decisionReason',
          'createdAt',
          'metadata',
        ],
      }),
      this.runRepository.find({
        where: {
          trigger: In(['scheduled', 'manual']),
          status: 'completed' as never,
          finishedAt: Between(lookbackStart, endExclusive),
        },
        select: ['id', 'repo', 'finishedAt'],
      }),
      this.eventRepository.find({
        where: {
          stage: 'merged' as never,
          createdAt: Between(start, endExclusive),
        },
        select: ['id', 'findingId', 'createdAt'],
      }),
    ]);
    const mergedFindingIds = [
      ...new Set(mergeEvents.map((e) => e.findingId).filter(Boolean)),
    ] as string[];
    const mergedFindings = mergedFindingIds.length
      ? await this.findingRepository.find({
          where: { id: In(mergedFindingIds) },
          select: ['id', 'createdAt'],
        })
      : [];
    const filedAt = new Map(mergedFindings.map((f) => [f.id, f.createdAt]));

    const sweepsByRepo = new Map<string, number[]>();
    for (const r of sweeps) {
      if (!r.finishedAt) continue;
      const list = sweepsByRepo.get(r.repo) ?? [];
      list.push(r.finishedAt.getTime());
      sweepsByRepo.set(r.repo, list);
    }
    const sweptBefore = (
      repo: string | null | undefined,
      at: Date,
    ): boolean => {
      if (!repo) return false;
      const t = at.getTime();
      return (sweepsByRepo.get(repo) ?? []).some(
        (s) => s <= t && t - s <= ESCAPE_LOOKBACK_MS,
      );
    };
    const finderError = (f: {
      status: string;
      decisionReason?: string | null;
    }) =>
      (f.status === 'dismissed' || f.status === 'rejected') &&
      !!f.decisionReason &&
      FINDER_ERROR_REASONS.has(f.decisionReason);

    const perWeek = new Map<string, GoalWeekDto>(
      weeks.map((week) => [
        week,
        {
          week,
          humanReports: 0,
          agentBugs: 0,
          firstFinderShare: null,
          escapes: 0,
          escapeRate: null,
          timeToFixHoursMedian: null,
        },
      ]),
    );
    const hoursByWeek = new Map<string, number[]>();
    const missReasons: Record<string, number> = {};
    let escapes = 0;
    let humanReports = 0;
    let agentBugs = 0;

    for (const f of findings) {
      if (finderError(f)) continue;
      const row = perWeek.get(weekStartIso(f.createdAt));
      if (f.source === 'reported_bug') {
        humanReports += 1;
        if (row) row.humanReports += 1;
        const reason =
          typeof f.metadata?.miss?.reason === 'string'
            ? (f.metadata.miss.reason as string)
            : 'unclassified';
        missReasons[reason] = (missReasons[reason] ?? 0) + 1;
        if (sweptBefore(f.repo, f.createdAt)) {
          escapes += 1;
          if (row) row.escapes += 1;
        }
      } else {
        agentBugs += 1;
        if (row) row.agentBugs += 1;
      }
    }
    const allHours: number[] = [];
    for (const e of mergeEvents) {
      const at = e.findingId ? filedAt.get(e.findingId) : undefined;
      if (!at) continue;
      const hours = (e.createdAt.getTime() - at.getTime()) / 36e5;
      if (hours < 0) continue;
      allHours.push(hours);
      const key = weekStartIso(e.createdAt);
      hoursByWeek.set(key, [...(hoursByWeek.get(key) ?? []), hours]);
    }
    for (const row of perWeek.values()) {
      row.firstFinderShare = rate(
        row.agentBugs,
        row.agentBugs + row.humanReports,
      );
      row.escapeRate = rate(row.escapes, row.humanReports);
      row.timeToFixHoursMedian = median(hoursByWeek.get(row.week) ?? []);
      if (row.firstFinderShare != null)
        row.firstFinderShare = round(row.firstFinderShare);
      if (row.escapeRate != null) row.escapeRate = round(row.escapeRate);
    }

    return {
      weekly: [...perWeek.values()],
      window: {
        humanReports,
        agentBugs,
        firstFinderShare: round0(rate(agentBugs, agentBugs + humanReports)),
        escapes,
        escapeRate: round0(rate(escapes, humanReports)),
        timeToFixHoursMedian: median(allHours),
        missReasons,
      },
    };
  }
}

/** Human reports count as escapes when a sweep had completed on the repo this recently. */
export const ESCAPE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const FINDER_ERROR_REASONS: ReadonlySet<string> = new Set([
  'not_a_bug',
  'duplicate',
  'wrong_repo',
]);

const round0 = (v: number | null): number | null =>
  v == null ? null : round(v);

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 10) / 10;
};

/** The UTC Monday that starts the week `date` falls in, as yyyy-mm-dd — the same label `generateBucketLabels` emits. */
export const weekStartIso = (date: Date): string => {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0 Sunday … 6 Saturday
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.toISOString().slice(0, 10);
};
