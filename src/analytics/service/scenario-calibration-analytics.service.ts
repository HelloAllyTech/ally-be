import { Injectable } from '@nestjs/common';

import { ScenarioDifficultyLevel } from 'src/learn/type/scenario.type';
import {
  ScenarioCalibrationBelowFloorDto,
  ScenarioCalibrationQueryDto,
  ScenarioCalibrationResponseDto,
  ScenarioCalibrationRowDto,
  ScenarioCalibrationTotalsDto,
  ScenarioProgressionCountsDto,
  ScenarioProgressionPointDto,
  ScenarioProgressionQueryDto,
  ScenarioProgressionResponseDto,
  ScenarioProgressionScenarioDto,
  ScenarioProgressionTotalsDto,
  ScenarioProgressionUntrackedReasonsDto,
  ScenarioScoreBandDto,
} from '../dto/scenario-calibration-analytics.dto';
import { AnalyticsRange } from '../dto/platform-analytics.dto';
import { AnalyticsBucket } from '../repository/platform-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  CalibrationSessionRow,
  ProgressionShapeRow,
  ScenarioCalibrationAnalyticsRepository,
  ScoringContributorRow,
} from '../repository/scenario-calibration-analytics.repository';
import {
  describeWindow,
  generateBucketLabels,
  resolveAnalyticsWindow,
} from '../util/analytics-window.util';
import {
  AttainableRange,
  CALIBRATION_TOO_EASY_TOP_BAND_PCT,
  CALIBRATION_TOO_HARD_BELOW_ZERO_PCT,
  DERIVED_SCORE_BANDS,
  RAW_SCORE_BANDS,
  ScoreBandKey,
  TOP_BAND_KEY,
  calibrationFlag,
  deriveAttainableRange,
  derivedBandKey,
  isRangeSuspect,
  rawBandKey,
} from '../util/scenario-score-range.util';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Share of `denominator`, 1 dp, or null below the floor (never 0 over 0). */
const pctOrNull = (
  count: number,
  denominator: number,
  floor: number,
): number | null =>
  denominator >= floor && denominator > 0
    ? round1((count / denominator) * 100)
    : null;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

const DIFFICULTY_LEVELS = new Set<string>(
  Object.values(ScenarioDifficultyLevel),
);

const titleOf = (scenarioId: number, title: string | null): string =>
  title && title.trim() ? title : `Scenario #${scenarioId}`;

/* -------------------------------------------------------------------------- */
/* Calibration (EFF-32, AAQ-227) — pure                                       */
/* -------------------------------------------------------------------------- */

/** A scenario's current scoring config, as the calibration reads it. */
export interface CalibrationScenarioConfig {
  range: AttainableRange;
  /** When that config last changed; null when nothing is on record. */
  configChangedAt: Date | null;
}

/** Fold contributor rows and change times into one config per scenario. */
export function buildCalibrationConfigs(
  contributors: readonly ScoringContributorRow[],
  changes: readonly { scenarioId: number; changedAt: Date | null }[],
): Map<number, CalibrationScenarioConfig> {
  const byScenario = new Map<number, ScoringContributorRow[]>();
  for (const c of contributors) {
    const list = byScenario.get(c.scenarioId) ?? [];
    list.push(c);
    byScenario.set(c.scenarioId, list);
  }
  const changedAt = new Map(changes.map((c) => [c.scenarioId, c.changedAt]));
  const ids = new Set<number>([...byScenario.keys(), ...changedAt.keys()]);
  const out = new Map<number, CalibrationScenarioConfig>();
  for (const id of ids) {
    out.set(id, {
      range: deriveAttainableRange(byScenario.get(id) ?? []),
      configChangedAt: changedAt.get(id) ?? null,
    });
  }
  return out;
}

export interface ScenarioCalibrationBuilt {
  rows: ScenarioCalibrationRowDto[];
  belowFloor: ScenarioCalibrationBelowFloorDto[];
  totals: ScenarioCalibrationTotalsDto;
}

/**
 * Group sessions per scenario version and read where their scores land.
 *
 * A version with fewer than `floor` resolved sessions goes to `belowFloor`
 * (n only). Otherwise the row is DERIVED when the scenario's current scoring
 * config yields an attainable max AND at least `floor` of the version's
 * sessions started at or after the config last changed — the bands are then
 * over those sessions only, so every banded score was earned under the config
 * the max describes (one constant standard across the sessions compared —
 * Stacks: "Monitoring Learner Progress with Consistent Standards"). Otherwise
 * it is RAW: raw-point bands over all of the version's sessions, with the
 * reason.
 */
export function buildScenarioCalibration(input: {
  sessions: readonly CalibrationSessionRow[];
  configByScenario: ReadonlyMap<number, CalibrationScenarioConfig>;
  floor: number;
}): ScenarioCalibrationBuilt {
  const { sessions, configByScenario, floor } = input;

  type Group = {
    scenarioId: number;
    versionId: string | null;
    versionNumber: number | null;
    title: string | null;
    difficultyLevel: string | null;
    sessions: CalibrationSessionRow[];
  };
  const groups = new Map<string, Group>();
  let unresolvedExcluded = 0;
  let resolvedTotal = 0;
  for (const s of sessions) {
    if (!s.resolved) {
      unresolvedExcluded += 1;
      continue;
    }
    resolvedTotal += 1;
    const key = `${s.scenarioId}|${s.versionId ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        scenarioId: s.scenarioId,
        versionId: s.versionId,
        versionNumber: s.versionNumber,
        title: s.title,
        difficultyLevel: s.difficultyLevel,
        sessions: [],
      };
      groups.set(key, g);
    }
    g.sessions.push(s);
  }

  const rows: ScenarioCalibrationRowDto[] = [];
  const belowFloor: ScenarioCalibrationBelowFloorDto[] = [];

  for (const g of groups.values()) {
    const title = titleOf(g.scenarioId, g.title);
    if (g.sessions.length < floor) {
      belowFloor.push({
        scenarioId: g.scenarioId,
        versionId: g.versionId,
        versionNumber: g.versionNumber,
        title,
        sessions: g.sessions.length,
      });
      continue;
    }

    const config = configByScenario.get(g.scenarioId) ?? null;
    const range = config?.range ?? null;
    const changedAt = config?.configChangedAt ?? null;

    let rangeSource: 'derived' | 'raw' = 'raw';
    let rangeReason: ScenarioCalibrationRowDto['rangeReason'] =
      'noScoredContributors';
    let banded = g.sessions;
    if (range?.derivable) {
      const sinceChange = changedAt
        ? g.sessions.filter((s) => s.startedAt.getTime() >= changedAt.getTime())
        : g.sessions;
      if (sinceChange.length >= floor) {
        rangeSource = 'derived';
        rangeReason = null;
        banded = sinceChange;
      } else {
        rangeReason = 'tooFewSinceConfigChange';
      }
    }

    const definitions =
      rangeSource === 'derived' ? DERIVED_SCORE_BANDS : RAW_SCORE_BANDS;
    const counts = new Map<ScoreBandKey, number>(
      definitions.map((d) => [d.key, 0]),
    );
    for (const s of banded) {
      const key =
        rangeSource === 'derived' && range?.max
          ? derivedBandKey(s.score, range.max)
          : rawBandKey(s.score);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const n = banded.length;
    const bands: ScenarioScoreBandDto[] = definitions.map((d) => ({
      key: d.key,
      label: d.label,
      count: counts.get(d.key) ?? 0,
      pct: pctOrNull(counts.get(d.key) ?? 0, n, floor),
    }));

    const topCount = counts.get(TOP_BAND_KEY[rangeSource]) ?? 0;
    const belowZero = counts.get('below0') ?? 0;
    const overMax = counts.get('over100') ?? 0;
    const medianRaw = n >= floor ? median(banded.map((s) => s.score)) : null;

    rows.push({
      scenarioId: g.scenarioId,
      versionId: g.versionId,
      versionNumber: g.versionNumber,
      title,
      difficultyLevel:
        g.difficultyLevel && DIFFICULTY_LEVELS.has(g.difficultyLevel)
          ? (g.difficultyLevel as ScenarioDifficultyLevel)
          : null,
      sessions: g.sessions.length,
      bandedSessions: n,
      rangeSource,
      rangeReason,
      attainableMax: range?.derivable ? range.max : null,
      attainableMin: range?.derivable ? range.min : null,
      ceilingIsHard: range?.derivable ? range.ceilingIsHard : null,
      uncappedContributors: range?.derivable ? range.uncappedPositive : 0,
      configStableSince: changedAt ? changedAt.toISOString() : null,
      bands,
      medianScore: medianRaw === null ? null : round2(medianRaw),
      flag: n >= floor ? calibrationFlag(topCount, belowZero, n) : null,
      rangeSuspect:
        rangeSource === 'derived' && range !== null
          ? isRangeSuspect(range, overMax)
          : false,
    });
  }

  rows.sort(
    (a, b) =>
      b.sessions - a.sessions ||
      a.scenarioId - b.scenarioId ||
      (a.versionNumber ?? -1) - (b.versionNumber ?? -1),
  );
  belowFloor.sort(
    (a, b) =>
      b.sessions - a.sessions ||
      a.scenarioId - b.scenarioId ||
      (a.versionNumber ?? -1) - (b.versionNumber ?? -1),
  );

  return {
    rows,
    belowFloor,
    totals: {
      sessions: resolvedTotal,
      unresolvedExcluded,
      rows: rows.length,
      derivedRows: rows.filter((r) => r.rangeSource === 'derived').length,
      tooEasy: rows.filter((r) => r.flag === 'tooEasy').length,
      tooHard: rows.filter((r) => r.flag === 'tooHard').length,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Progression (EFF-34, AAQ-228) — pure                                       */
/* -------------------------------------------------------------------------- */

export type ProgressionClass = 'reachedTerminal' | 'advanced' | 'neverAdvanced';
export type ProgressionUntrackedReason =
  keyof ScenarioProgressionUntrackedReasonsDto;

export type ProgressionClassification =
  | { tracked: true; cls: ProgressionClass; fellBackOnly: boolean }
  | { tracked: false; reason: ProgressionUntrackedReason };

/**
 * Classify one session's state summary.
 *
 *  - no turn carries `stateCount` → untracked `noStateMetadata` (builds before
 *    2026-06-10, scenarios without states, no turn metrics);
 *  - `stateCount` but no `stateIndex` on any turn → untracked `branchingMode`;
 *  - one state, or opened in the last state → untracked `noRoomToAdvance`
 *    (every such session would read as "reached the end" for free);
 *  - else reachedTerminal (`stateIsTerminal` seen, or furthest = last index),
 *    advanced (furthest above the opening state), or neverAdvanced — with
 *    `fellBackOnly` when it dipped below its opening state and never rose
 *    above it.
 *
 * The opening state is the state of the first state-bearing turn: states are
 * score windows sorted by their lower bound, and the session opens in the one
 * containing 0, which need not be index 0.
 */
export function classifyProgression(
  shape: Pick<
    ProgressionShapeRow,
    | 'hasStateMetadata'
    | 'states'
    | 'opening'
    | 'furthest'
    | 'lowest'
    | 'reachedEnd'
  >,
): ProgressionClassification {
  if (!shape.hasStateMetadata) {
    return { tracked: false, reason: 'noStateMetadata' };
  }
  if (shape.opening === null) {
    return { tracked: false, reason: 'branchingMode' };
  }
  const last = shape.states === null ? null : shape.states - 1;
  if (last === null || last < 1 || shape.opening >= last) {
    return { tracked: false, reason: 'noRoomToAdvance' };
  }
  const furthest = shape.furthest ?? shape.opening;
  if (shape.reachedEnd || furthest >= last) {
    return { tracked: true, cls: 'reachedTerminal', fellBackOnly: false };
  }
  if (furthest > shape.opening) {
    return { tracked: true, cls: 'advanced', fellBackOnly: false };
  }
  const lowest = shape.lowest ?? shape.opening;
  return {
    tracked: true,
    cls: 'neverAdvanced',
    fellBackOnly: lowest < shape.opening,
  };
}

interface ProgressionAcc {
  reachedTerminal: number;
  advanced: number;
  neverAdvanced: number;
  fellBackOnly: number;
  untracked: number;
  untrackedByReason: Record<ProgressionUntrackedReason, number>;
}

const emptyAcc = (): ProgressionAcc => ({
  reachedTerminal: 0,
  advanced: 0,
  neverAdvanced: 0,
  fellBackOnly: 0,
  untracked: 0,
  untrackedByReason: {
    noStateMetadata: 0,
    branchingMode: 0,
    noRoomToAdvance: 0,
  },
});

function addShape(
  acc: ProgressionAcc,
  c: ProgressionClassification,
  n: number,
): void {
  if (!c.tracked) {
    acc.untracked += n;
    acc.untrackedByReason[c.reason] += n;
    return;
  }
  acc[c.cls] += n;
  if (c.fellBackOnly) acc.fellBackOnly += n;
}

function toCounts(
  acc: ProgressionAcc,
  floor: number,
): ScenarioProgressionCountsDto {
  const sessions = acc.reachedTerminal + acc.advanced + acc.neverAdvanced;
  return {
    sessions,
    reachedTerminal: acc.reachedTerminal,
    advanced: acc.advanced,
    neverAdvanced: acc.neverAdvanced,
    reachedTerminalPct: pctOrNull(acc.reachedTerminal, sessions, floor),
    advancedPct: pctOrNull(acc.advanced, sessions, floor),
    neverAdvancedPct: pctOrNull(acc.neverAdvanced, sessions, floor),
    fellBackOnly: acc.fellBackOnly,
    untracked: acc.untracked,
  };
}

export interface ScenarioProgressionBuilt {
  points: ScenarioProgressionPointDto[];
  totals: ScenarioProgressionTotalsDto;
  byScenario: ScenarioProgressionScenarioDto[];
}

/**
 * Classify every shape and fold it into gap-filled bucket points, the window
 * total and the per-scenario expanded view. Counts are summed first and
 * divided once; a share is null below `floor` tracked sessions.
 */
export function buildScenarioProgression(input: {
  shapes: readonly ProgressionShapeRow[];
  bucketLabels: readonly string[];
  floor: number;
}): ScenarioProgressionBuilt {
  const { shapes, bucketLabels, floor } = input;
  const byBucket = new Map<string, ProgressionAcc>(
    bucketLabels.map((b) => [b, emptyAcc()]),
  );
  const byScenario = new Map<
    number,
    { title: string | null; acc: ProgressionAcc }
  >();
  const total = emptyAcc();

  for (const shape of shapes) {
    const c = classifyProgression(shape);
    addShape(total, c, shape.sessions);
    // Session ends inside the window always land on one of its labels; a
    // stray key (clock edge) still counts in the totals above.
    const bucketAcc = byBucket.get(shape.bucket);
    if (bucketAcc) addShape(bucketAcc, c, shape.sessions);
    const sc = byScenario.get(shape.scenarioId) ?? {
      title: shape.title,
      acc: emptyAcc(),
    };
    addShape(sc.acc, c, shape.sessions);
    byScenario.set(shape.scenarioId, sc);
  }

  const points = bucketLabels.map((bucket) => ({
    bucket,
    ...toCounts(byBucket.get(bucket) ?? emptyAcc(), floor),
  }));

  const scenarios = [...byScenario.entries()]
    .map(([scenarioId, { title, acc }]) => ({
      scenarioId,
      title: titleOf(scenarioId, title),
      ...toCounts(acc, floor),
    }))
    .filter((r) => r.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions || a.scenarioId - b.scenarioId);

  return {
    points,
    totals: {
      ...toCounts(total, floor),
      untrackedByReason: { ...total.untrackedByReason },
    },
    byScenario: scenarios,
  };
}

/* -------------------------------------------------------------------------- */
/* Service                                                                    */
/* -------------------------------------------------------------------------- */

/** Week buckets for the short presets, month for a year or more. */
const defaultBucketFor = (range: AnalyticsRange): AnalyticsBucket =>
  range === '30d' || range === '90d' ? 'week' : 'month';

const CALIBRATION_PROVENANCE = {
  derivation:
    'R2 session score: scenario_sessions.score, the worker’s final total of detected event points plus behaviour-instruction points (+10 / −10 per detected learner turn). ' +
    'Countable sessions (ENDED + COMPLETED, no preview or seed rooms), test orgs excluded, the unresolved 0 (no detected event) dropped. One row per scenario version with at least minSampleSize sessions. ' +
    'Attainable max from the scenario’s CURRENT scoring config: Σ positive event score × detectionConfig.maxOccurrences + 10 per SHOULD_DO behaviour instruction, an uncapped contributor counted once; ' +
    'bands are shares of it over the sessions that started since that config last changed. With no usable max, raw-point bands over every session of the version.',
  note:
    'Difficulty is an authoring label; this measures how scores land, which is a property of the scenario’s scoring AND of the learners who play it. ' +
    'Scores compare only under one scoring config. Where a contributor is uncapped the ceiling is nominal (each counted once), so sessions above 100% are expected there.',
};

const PROGRESSION_PROVENANCE = {
  derivation:
    'R9 state progression: the simulation state each turn ran in, stamped by the voice worker on scenario_session_turn_metrics.metadata (stateIndex, stateCount, stateIsTerminal) since 2026-06-10. ' +
    'Per countable session (ENDED + COMPLETED, no preview or seed rooms, test orgs excluded), bucketed by session end: reached the last state, advanced past the state it opened in, or never got past it. ' +
    'Sessions with no usable state (older builds, branching mode, single-state scenarios) are counted as untracked and not plotted.',
  note: 'States are score-windowed — the client moves to the next state when the cumulative session score crosses its window — so this is a learner-progress proxy only to the extent the scenario’s event scores track good helping.',
};

/**
 * Scenario difficulty calibration (AAQ-227) and "did the learner move the
 * client?" state progression (AAQ-228). Pure assembly lives in the exported
 * `build*` / `classifyProgression` functions above; this class only fetches.
 */
@Injectable()
export class ScenarioCalibrationAnalyticsService {
  constructor(private readonly repo: ScenarioCalibrationAnalyticsRepository) {}

  async getCalibration(
    query: ScenarioCalibrationQueryDto,
  ): Promise<ScenarioCalibrationResponseDto> {
    const tenantId = query.tenantId || undefined;
    const sessions = await this.repo.getCalibrationSessions(tenantId);
    const scenarioIds = [
      ...new Set(sessions.filter((s) => s.resolved).map((s) => s.scenarioId)),
    ];
    const [contributors, changes] = await Promise.all([
      this.repo.getScoringContributors(scenarioIds),
      this.repo.getScoringConfigChangedAt(scenarioIds),
    ]);
    const built = buildScenarioCalibration({
      sessions,
      configByScenario: buildCalibrationConfigs(contributors, changes),
      floor: MIN_SCORE_SAMPLE_SIZE,
    });

    return {
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      ...built,
      bandDefinitions: {
        derived: DERIVED_SCORE_BANDS.map((b) => ({ ...b })),
        raw: RAW_SCORE_BANDS.map((b) => ({ ...b })),
      },
      thresholds: {
        tooEasyTopBandPct: CALIBRATION_TOO_EASY_TOP_BAND_PCT,
        tooHardBelowZeroPct: CALIBRATION_TOO_HARD_BELOW_ZERO_PCT,
      },
      provenance: { ...CALIBRATION_PROVENANCE },
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  async getProgression(
    query: ScenarioProgressionQueryDto,
  ): Promise<ScenarioProgressionResponseDto> {
    const tenantId = query.tenantId || undefined;
    const needsFloor = query.range === 'all' && !query.from && !query.to;
    const window = resolveAnalyticsWindow(query, {
      defaultRange: '90d',
      defaultBucketFor,
      allTimeStart: needsFloor ? await this.repo.getDataFloor() : undefined,
    });
    const { start, endExclusive, bucket } = window;

    const shapes = await this.repo.getProgressionShapes(
      start,
      endExclusive,
      bucket,
      tenantId,
    );
    const built = buildScenarioProgression({
      shapes,
      bucketLabels: generateBucketLabels(start, endExclusive, bucket),
      floor: MIN_SCORE_SAMPLE_SIZE,
    });

    return {
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      window: describeWindow(window),
      ...built,
      provenance: { ...PROGRESSION_PROVENANCE },
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
