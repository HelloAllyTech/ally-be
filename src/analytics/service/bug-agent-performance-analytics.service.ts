import { Injectable } from '@nestjs/common';

import { BugFindingRepository } from 'src/bug-hunter/repository/bug-finding.repository';
import { BugHuntRunRepository } from 'src/bug-hunter/repository/bug-hunt-run.repository';
import { BugHuntEventRepository } from 'src/bug-hunter/repository/bug-hunt-event.repository';
import {
  foldFunnel,
  groupFunnels,
} from 'src/bug-hunter/service/bug-hunter-metrics.service';

import {
  BugAgentPerformanceQueryDto,
  BugAgentPerformanceResponseDto,
  CostWeekDto,
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

const defaultBucketFor = () => 'week' as const;

/** Null when the denominator is zero — a rate over nothing is not zero, it is unmeasured. */
const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

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

    const [
      outcomeRows,
      regressionRows,
      queueRows,
      stageLatencyRows,
      runRows,
      escalationRows,
      fallbackRows,
    ] = await Promise.all([
      this.findingRepository.weeklyOutcomeCounts(start, endExclusive),
      this.findingRepository.weeklyRegressionCounts(start, endExclusive),
      this.findingRepository.weeklyQueueToStartLatency(start, endExclusive),
      this.findingRepository.weeklyStageLatencies(start, endExclusive),
      this.runRepository.weeklyRunStats(start, endExclusive),
      this.eventRepository.weeklyEscalationCounts(start, endExclusive),
      this.eventRepository.weeklyFallbackCounts(start, endExclusive),
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

    return {
      precision: { weekly: precisionWeekly, bySource },
      throughput: throughputWeekly,
      speed: speedWeekly,
      cost: costWeekly,
      reliability: reliabilityWeekly,
      window: describeWindow(window),
      computedAt: new Date().toISOString(),
    };
  }
}
