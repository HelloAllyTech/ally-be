import { Injectable } from '@nestjs/common';

import {
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FHS_BENCHMARK_MIN_CUTS_BETWEEN,
  FHS_BENCHMARK_MIN_LEARNER_CHARS,
} from 'src/foundational-skills/constants/fhs-benchmark.constants';
import {
  FoundationalSkillsBenchmarkLearnerDto,
  FoundationalSkillsBenchmarkResponseDto,
  FoundationalSkillsBenchmarkSessionRefDto,
  FoundationalSkillsBenchmarkSkillDto,
  FoundationalSkillsBenchmarkSummaryDto,
} from '../dto/foundational-skills-benchmark.dto';
import {
  BenchmarkSessionRow,
  FoundationalSkillsBenchmarkAnalyticsRepository,
} from '../repository/foundational-skills-benchmark.repository';
// One floor for every judged score on the platform — see SkillGrowthAnalyticsService.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import { pairedChange } from '../util/paired-stats.util';

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round4 = (v: number): number => Math.round(v * 10000) / 10000;
const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/** One learner's comparison: first vs latest session of ONE benchmark scenario. */
export interface BenchmarkPair {
  userId: number;
  scenarioId: number;
  first: BenchmarkSessionRow;
  latest: BenchmarkSessionRow;
  /** latest.cutsBefore − first.cutsBefore: the practice in between. */
  cutsBetween: number;
}

const byEnd = (a: BenchmarkSessionRow, b: BenchmarkSessionRow): number =>
  a.endedAt.getTime() - b.endedAt.getTime() ||
  (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0);

/**
 * The pairing rule, in one place so no client can apply it differently.
 *
 * For each learner and each benchmark scenario: their FIRST scored session of
 * that scenario against their LATEST scored session of the SAME scenario,
 * kept only when the latest came at least `minCutsBetween` more cuts of
 * practice after the first. Same scenario on both ends is the point — it is
 * what removes the scenario mix that makes cut-to-cut scores noise.
 *
 * Only the latest is tried: the dose (`cutsBefore`) never falls as sessions
 * get later, so if the latest is too close to the first, every session is.
 *
 * A learner counts once. With qualifying pairs on several benchmark scenarios
 * the one with the most practice in between wins (then the most recent retake,
 * then the lower scenario id, so the choice is deterministic).
 *
 * Returned most recent retake first.
 */
export function pairBenchmarkSessions(
  rows: readonly BenchmarkSessionRow[],
  minCutsBetween: number,
): BenchmarkPair[] {
  const groups = new Map<string, BenchmarkSessionRow[]>();
  for (const row of rows) {
    const key = `${row.userId}:${row.scenarioId}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const best = new Map<number, BenchmarkPair>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort(byEnd);
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    const cutsBetween = latest.cutsBefore - first.cutsBefore;
    if (cutsBetween < minCutsBetween) continue;

    const candidate: BenchmarkPair = {
      userId: first.userId,
      scenarioId: first.scenarioId,
      first,
      latest,
      cutsBetween,
    };
    const current = best.get(candidate.userId);
    if (!current || isBetterPair(candidate, current)) {
      best.set(candidate.userId, candidate);
    }
  }

  return [...best.values()].sort(
    (a, b) =>
      b.latest.endedAt.getTime() - a.latest.endedAt.getTime() ||
      a.userId - b.userId,
  );
}

function isBetterPair(a: BenchmarkPair, b: BenchmarkPair): boolean {
  if (a.cutsBetween !== b.cutsBetween) return a.cutsBetween > b.cutsBetween;
  const aEnd = a.latest.endedAt.getTime();
  const bEnd = b.latest.endedAt.getTime();
  if (aEnd !== bEnd) return aEnd > bEnd;
  return a.scenarioId < b.scenarioId;
}

/**
 * A paired comparison with the platform's sample floor applied: below
 * {@link MIN_SCORE_SAMPLE_SIZE} learners every average, interval and test is
 * withheld (null; `detectable` false) while the counts still travel, so the
 * card can say "n = 12 · need 20" instead of a number one learner can swing.
 */
function flooredComparison(firsts: number[], latests: number[]) {
  const n = firsts.length;
  const stats = pairedChange(latests.map((v, i) => v - firsts[i]));
  const enough = n >= MIN_SCORE_SAMPLE_SIZE;
  return {
    n,
    firstAvg: enough ? round2(mean(firsts)) : null,
    latestAvg: enough ? round2(mean(latests)) : null,
    change:
      enough && stats.meanChange !== null ? round2(stats.meanChange) : null,
    changeCi:
      enough && stats.ci
        ? ([round2(stats.ci[0]), round2(stats.ci[1])] as [number, number])
        : null,
    up: stats.up,
    down: stats.down,
    tied: stats.tied,
    signP: enough && stats.signP !== null ? round4(stats.signP) : null,
    detectable: enough && stats.detectable,
  };
}

const sessionRef = (
  row: BenchmarkSessionRow,
): FoundationalSkillsBenchmarkSessionRefDto => ({
  sessionId: row.sessionId,
  endedAt: row.endedAt.toISOString(),
  cutsBefore: row.cutsBefore,
  composite: round2(row.composite),
});

const hasLevel = (levels: Record<string, number>, skill: string): boolean =>
  Object.prototype.hasOwnProperty.call(levels, skill) &&
  Number.isFinite(Number(levels[skill]));

/**
 * The benchmark before/after chart (AAQ-189): each learner's first and latest
 * sessions of a fixed benchmark roleplay, scored on the foundational helping
 * skills rubric, compared within the learner.
 *
 * With no roleplay flagged it returns an empty `scenarios` and zero counts,
 * never a 404 — the chart explains how to flag one.
 */
@Injectable()
export class FoundationalSkillsBenchmarkAnalyticsService {
  constructor(
    private readonly repository: FoundationalSkillsBenchmarkAnalyticsRepository,
  ) {}

  async getBenchmark(): Promise<FoundationalSkillsBenchmarkResponseDto> {
    const [scenarios, coverage, rows] = await Promise.all([
      this.repository.getScenarios(FHS_RUBRIC_VERSION),
      this.repository.getCoverage(FHS_RUBRIC_VERSION),
      this.repository.getScoredSessions(FHS_RUBRIC_VERSION),
    ]);

    const pairs = pairBenchmarkSessions(rows, FHS_BENCHMARK_MIN_CUTS_BETWEEN);

    const overall = flooredComparison(
      pairs.map((p) => p.first.composite),
      pairs.map((p) => p.latest.composite),
    );
    const summary: FoundationalSkillsBenchmarkSummaryDto = {
      learners: overall.n,
      firstAvg: overall.firstAvg,
      latestAvg: overall.latestAvg,
      change: overall.change,
      changeCi: overall.changeCi,
      up: overall.up,
      down: overall.down,
      tied: overall.tied,
      signP: overall.signP,
      detectable: overall.detectable,
    };

    // Per skill, only the learners for whom the skill was assessable at BOTH
    // ends: an absent key means the session gave no opportunity for it, and
    // counting that as a low score would invent a change.
    const skills: FoundationalSkillsBenchmarkSkillDto[] = FHS_RUBRIC.map(
      (skill) => {
        const both = pairs.filter(
          (p) =>
            hasLevel(p.first.levels, skill.key) &&
            hasLevel(p.latest.levels, skill.key),
        );
        const c = flooredComparison(
          both.map((p) => Number(p.first.levels[skill.key])),
          both.map((p) => Number(p.latest.levels[skill.key])),
        );
        return {
          skill: skill.key,
          name: skill.name,
          pairedLearners: c.n,
          firstAvg: c.firstAvg,
          latestAvg: c.latestAvg,
          change: c.change,
          changeCi: c.changeCi,
          detectable: c.detectable,
        };
      },
    );

    const learners: FoundationalSkillsBenchmarkLearnerDto[] = pairs.map(
      (p) => ({
        id: p.userId,
        name: p.latest.name ?? p.first.name,
        tenantId: p.latest.tenantId,
        scenarioId: String(p.scenarioId),
        first: sessionRef(p.first),
        latest: sessionRef(p.latest),
        change: round2(p.latest.composite - p.first.composite),
      }),
    );

    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: [1, 4],
      minLearnerChars: FHS_BENCHMARK_MIN_LEARNER_CHARS,
      minCutsBetween: FHS_BENCHMARK_MIN_CUTS_BETWEEN,
      scenarios: scenarios.map((s) => ({
        id: String(s.id),
        title: s.title ?? `Scenario ${s.id}`,
        sessionsScored: s.sessionsScored,
      })),
      coverage: {
        ...coverage,
        learnersWithOne: new Set(rows.map((r) => r.userId)).size,
        learnersPaired: pairs.length,
      },
      summary,
      skills,
      learners,
      computedAt: new Date().toISOString(),
    };
  }
}
