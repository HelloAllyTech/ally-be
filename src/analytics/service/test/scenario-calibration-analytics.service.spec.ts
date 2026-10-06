import {
  CalibrationSessionRow,
  ProgressionShapeRow,
  ScenarioCalibrationAnalyticsRepository,
} from '../../repository/scenario-calibration-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import { deriveAttainableRange } from '../../util/scenario-score-range.util';
import {
  CalibrationScenarioConfig,
  ScenarioCalibrationAnalyticsService,
  buildCalibrationConfigs,
  buildScenarioCalibration,
  buildScenarioProgression,
  classifyProgression,
} from '../scenario-calibration-analytics.service';

const FLOOR = 20;
const T0 = new Date('2026-07-01T00:00:00Z');
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

const session = (
  score: number,
  over: Partial<CalibrationSessionRow> = {},
): CalibrationSessionRow => ({
  scenarioId: 1,
  versionId: 'v-1',
  versionNumber: 1,
  title: 'Grief call',
  difficultyLevel: 'EASY',
  score,
  startedAt: day(10),
  resolved: true,
  ...over,
});

const many = (
  scores: readonly number[],
  over: Partial<CalibrationSessionRow> = {},
): CalibrationSessionRow[] => scores.map((s) => session(s, over));

const hardConfig = (
  max: number,
  configChangedAt: Date | null = day(0),
): CalibrationScenarioConfig => ({
  // one event, score max/2, capped at 2 fires → a hard ceiling of `max`
  range: deriveAttainableRange([
    { kind: 'event', score: max / 2, maxOccurrences: 2 },
  ]),
  configChangedAt,
});

const configs = (entries: [number, CalibrationScenarioConfig][]) =>
  new Map(entries);

const bandCount = (
  row: { bands: { key: string; count: number }[] },
  key: string,
) => row.bands.find((b) => b.key === key)?.count;

describe('buildScenarioCalibration', () => {
  it('drops the unresolved 0 but counts it, and lists thin versions below the floor', () => {
    const sessions = [
      ...many(Array(FLOOR).fill(40)),
      session(0, { resolved: false }),
      session(0, { resolved: false }),
      ...many([10, 20, 30], { versionId: 'v-2', versionNumber: 2 }),
    ];
    const built = buildScenarioCalibration({
      sessions,
      configByScenario: configs([[1, hardConfig(100)]]),
      floor: FLOOR,
    });

    expect(built.totals.unresolvedExcluded).toBe(2);
    expect(built.totals.sessions).toBe(FLOOR + 3);
    expect(built.rows).toHaveLength(1);
    expect(built.rows[0].sessions).toBe(FLOOR);
    expect(built.belowFloor).toEqual([
      {
        scenarioId: 1,
        versionId: 'v-2',
        versionNumber: 2,
        title: 'Grief call',
        sessions: 3,
      },
    ]);
  });

  it('bands a derived row as shares of the attainable max, > 100% counted, not hidden', () => {
    // max 80: 2 below 0, 4 in 0–25%, 4 in 25–50%, 4 in 50–75%, 4 in 75–100%, 2 above
    const scores = [
      -5, -1, 0, 5, 10, 19, 20, 25, 30, 39, 40, 45, 50, 59, 60, 70, 79, 80, 81,
      120,
    ];
    const [row] = buildScenarioCalibration({
      sessions: many(scores),
      configByScenario: configs([[1, hardConfig(80)]]),
      floor: FLOOR,
    }).rows;

    expect(row.rangeSource).toBe('derived');
    expect(row.rangeReason).toBeNull();
    expect(row.attainableMax).toBe(80);
    expect(row.ceilingIsHard).toBe(true);
    expect(row.bands.map((b) => [b.key, b.count])).toEqual([
      ['below0', 2],
      ['pct0to25', 4],
      ['pct25to50', 4],
      ['pct50to75', 4],
      ['pct75to100', 4],
      ['over100', 2],
    ]);
    expect(row.bands[0].pct).toBe(10);
    expect(row.bands.reduce((n, b) => n + (b.pct ?? 0), 0)).toBeCloseTo(100);
    // Above a HARD ceiling: a derivation problem, shown and marked.
    expect(row.rangeSuspect).toBe(true);
    expect(row.flag).toBeNull();
    expect(row.medianScore).toBe(39.5);
  });

  it('does not mark sessions above a NOMINAL ceiling (an uncapped contributor counted once)', () => {
    const nominal: CalibrationScenarioConfig = {
      range: deriveAttainableRange([
        { kind: 'event', score: 20, maxOccurrences: null },
        { kind: 'behaviour', score: 10, maxOccurrences: null },
      ]),
      configChangedAt: day(0),
    };
    const [row] = buildScenarioCalibration({
      sessions: many(Array(FLOOR).fill(90)),
      configByScenario: configs([[1, nominal]]),
      floor: FLOOR,
    }).rows;
    expect(row.attainableMax).toBe(30);
    expect(row.ceilingIsHard).toBe(false);
    expect(row.uncappedContributors).toBe(2);
    expect(bandCount(row, 'over100')).toBe(FLOOR);
    expect(row.rangeSuspect).toBe(false);
  });

  it('reads a derived range only over sessions since the scoring config last changed', () => {
    const before = many(Array(15).fill(10), { startedAt: day(1) });
    const after = many(Array(FLOOR).fill(90), { startedAt: day(30) });
    const [row] = buildScenarioCalibration({
      sessions: [...before, ...after],
      configByScenario: configs([[1, hardConfig(100, day(20))]]),
      floor: FLOOR,
    }).rows;

    expect(row.sessions).toBe(35);
    expect(row.bandedSessions).toBe(FLOOR);
    expect(row.rangeSource).toBe('derived');
    expect(row.configStableSince).toBe(day(20).toISOString());
    expect(bandCount(row, 'pct75to100')).toBe(FLOOR);
    expect(row.flag).toBe('tooEasy');
  });

  it('falls back to raw bands over every session when too few ran on the current config', () => {
    const before = many(Array(30).fill(60), { startedAt: day(1) });
    const after = many(Array(5).fill(60), { startedAt: day(30) });
    const [row] = buildScenarioCalibration({
      sessions: [...before, ...after],
      configByScenario: configs([[1, hardConfig(100, day(20))]]),
      floor: FLOOR,
    }).rows;

    expect(row.rangeSource).toBe('raw');
    expect(row.rangeReason).toBe('tooFewSinceConfigChange');
    expect(row.bandedSessions).toBe(35);
    // The derivation still travels, for reference.
    expect(row.attainableMax).toBe(100);
    expect(row.bands.map((b) => b.key)).toEqual([
      'below0',
      'raw0to49',
      'raw50to99',
      'raw100plus',
    ]);
    expect(bandCount(row, 'raw50to99')).toBe(35);
    expect(row.rangeSuspect).toBe(false);
  });

  it('falls back to raw bands when the scenario has nothing that adds points', () => {
    const [row] = buildScenarioCalibration({
      sessions: many(Array(FLOOR).fill(120)),
      configByScenario: configs([]),
      floor: FLOOR,
    }).rows;
    expect(row.rangeSource).toBe('raw');
    expect(row.rangeReason).toBe('noScoredContributors');
    expect(row.attainableMax).toBeNull();
    expect(row.ceilingIsHard).toBeNull();
    // 100+ is the raw top band
    expect(row.flag).toBe('tooEasy');
  });

  it('flags too hard when more than half the sessions land below 0', () => {
    const [row] = buildScenarioCalibration({
      sessions: many([...Array(11).fill(-10), ...Array(9).fill(30)]),
      configByScenario: configs([[1, hardConfig(100)]]),
      floor: FLOOR,
    }).rows;
    expect(row.flag).toBe('tooHard');
  });

  it('splits rows by version, sorts by sessions, and cleans the authored label and title', () => {
    const built = buildScenarioCalibration({
      sessions: [
        ...many(Array(FLOOR).fill(10), {
          scenarioId: 2,
          versionId: null,
          versionNumber: null,
          title: null,
          difficultyLevel: 'NOT_A_LEVEL',
        }),
        ...many(Array(FLOOR + 5).fill(10), { scenarioId: 3 }),
        ...many(Array(FLOOR).fill(10), {
          scenarioId: 3,
          versionId: 'v-9',
          versionNumber: 9,
        }),
      ],
      configByScenario: configs([]),
      floor: FLOOR,
    });
    expect(
      built.rows.map((r) => [r.scenarioId, r.versionNumber, r.sessions]),
    ).toEqual([
      [3, 1, FLOOR + 5],
      [2, null, FLOOR],
      [3, 9, FLOOR],
    ]);
    const unnamed = built.rows.find((r) => r.scenarioId === 2);
    expect(unnamed?.title).toBe('Scenario #2');
    expect(unnamed?.difficultyLevel).toBeNull();
    expect(built.rows[0].difficultyLevel).toBe('EASY');
  });

  it('returns empty lists, never a fabricated row, with no sessions', () => {
    expect(
      buildScenarioCalibration({
        sessions: [],
        configByScenario: configs([]),
        floor: FLOOR,
      }),
    ).toEqual({
      rows: [],
      belowFloor: [],
      totals: {
        sessions: 0,
        unresolvedExcluded: 0,
        rows: 0,
        derivedRows: 0,
        tooEasy: 0,
        tooHard: 0,
      },
    });
  });
});

describe('buildCalibrationConfigs', () => {
  it('derives one range per scenario and attaches its last change', () => {
    const map = buildCalibrationConfigs(
      [
        { scenarioId: 1, kind: 'event', score: 10, maxOccurrences: 3 },
        { scenarioId: 1, kind: 'behaviour', score: 10, maxOccurrences: null },
        { scenarioId: 2, kind: 'event', score: -5, maxOccurrences: 1 },
      ],
      [
        { scenarioId: 1, changedAt: day(3) },
        { scenarioId: 4, changedAt: null },
      ],
    );
    expect(map.get(1)?.range.max).toBe(40);
    expect(map.get(1)?.configChangedAt).toEqual(day(3));
    expect(map.get(2)?.range.derivable).toBe(false);
    expect(map.get(4)?.range.derivable).toBe(false);
    expect(map.get(4)?.configChangedAt).toBeNull();
  });
});

const shape = (
  over: Partial<ProgressionShapeRow> = {},
): ProgressionShapeRow => ({
  bucket: '2026-07-01',
  scenarioId: 1,
  title: 'Grief call',
  hasStateMetadata: true,
  states: 3,
  opening: 0,
  furthest: 0,
  lowest: 0,
  reachedEnd: false,
  sessions: 1,
  ...over,
});

describe('classifyProgression', () => {
  it('reads a session that reached the last state as reachedTerminal', () => {
    expect(classifyProgression(shape({ furthest: 2 }))).toEqual({
      tracked: true,
      cls: 'reachedTerminal',
      fellBackOnly: false,
    });
    // the worker's own flag counts even if the index summary disagrees
    expect(classifyProgression(shape({ reachedEnd: true }))).toMatchObject({
      cls: 'reachedTerminal',
    });
  });

  it('reads movement past the opening state as advanced', () => {
    expect(classifyProgression(shape({ furthest: 1 }))).toMatchObject({
      tracked: true,
      cls: 'advanced',
    });
  });

  it('measures "advanced" from the OPENING state, which need not be index 0', () => {
    // states [-∞,0) [0,50) [50,80) [80,∞): opens in index 1
    const opensAt1 = { states: 4, opening: 1 };
    expect(
      classifyProgression(shape({ ...opensAt1, furthest: 1, lowest: 0 })),
    ).toEqual({ tracked: true, cls: 'neverAdvanced', fellBackOnly: true });
    expect(
      classifyProgression(shape({ ...opensAt1, furthest: 2, lowest: 0 })),
    ).toMatchObject({ cls: 'advanced' });
    expect(
      classifyProgression(shape({ ...opensAt1, furthest: 1, lowest: 1 })),
    ).toEqual({ tracked: true, cls: 'neverAdvanced', fellBackOnly: false });
  });

  it('counts sessions with no usable state as untracked, by reason', () => {
    expect(
      classifyProgression(
        shape({ hasStateMetadata: false, states: null, opening: null }),
      ),
    ).toEqual({ tracked: false, reason: 'noStateMetadata' });
    expect(
      classifyProgression(
        shape({ opening: null, furthest: null, lowest: null }),
      ),
    ).toEqual({ tracked: false, reason: 'branchingMode' });
    expect(classifyProgression(shape({ states: 1 }))).toEqual({
      tracked: false,
      reason: 'noRoomToAdvance',
    });
    expect(
      classifyProgression(shape({ opening: 2, furthest: 2, reachedEnd: true })),
    ).toEqual({ tracked: false, reason: 'noRoomToAdvance' });
  });
});

describe('buildScenarioProgression', () => {
  const labels = ['2026-06-01', '2026-07-01', '2026-08-01'];

  it('gap-fills buckets, divides once, and withholds shares below the floor', () => {
    const built = buildScenarioProgression({
      shapes: [
        shape({ bucket: '2026-07-01', furthest: 2, sessions: 6 }),
        shape({ bucket: '2026-07-01', furthest: 1, sessions: 4 }),
        shape({ bucket: '2026-07-01', sessions: 10 }),
        shape({ bucket: '2026-07-01', hasStateMetadata: false, sessions: 7 }),
        shape({ bucket: '2026-08-01', furthest: 1, sessions: 3 }),
      ],
      bucketLabels: labels,
      floor: FLOOR,
    });

    expect(built.points.map((p) => p.bucket)).toEqual(labels);
    const [june, july, august] = built.points;
    expect(june).toMatchObject({
      sessions: 0,
      untracked: 0,
      reachedTerminalPct: null,
      advancedPct: null,
      neverAdvancedPct: null,
    });
    expect(july).toMatchObject({
      sessions: 20,
      reachedTerminal: 6,
      advanced: 4,
      neverAdvanced: 10,
      reachedTerminalPct: 30,
      advancedPct: 20,
      neverAdvancedPct: 50,
      untracked: 7,
    });
    expect(august).toMatchObject({
      sessions: 3,
      advanced: 3,
      advancedPct: null,
    });

    expect(built.totals).toMatchObject({
      sessions: 23,
      reachedTerminal: 6,
      advanced: 7,
      neverAdvanced: 10,
      untracked: 7,
      untrackedByReason: {
        noStateMetadata: 7,
        branchingMode: 0,
        noRoomToAdvance: 0,
      },
    });
    expect(built.totals.advancedPct).toBeCloseTo(30.4);
  });

  it('lists scenarios with tracked sessions only, most first', () => {
    const built = buildScenarioProgression({
      shapes: [
        shape({ scenarioId: 1, sessions: 2 }),
        shape({ scenarioId: 2, title: null, furthest: 2, sessions: 25 }),
        shape({ scenarioId: 3, opening: null, sessions: 40 }),
      ],
      bucketLabels: labels,
      floor: FLOOR,
    });
    expect(built.byScenario.map((s) => [s.scenarioId, s.sessions])).toEqual([
      [2, 25],
      [1, 2],
    ]);
    expect(built.byScenario[0]).toMatchObject({
      title: 'Scenario #2',
      reachedTerminalPct: 100,
    });
    expect(built.byScenario[1].neverAdvancedPct).toBeNull();
    expect(built.totals.untrackedByReason.branchingMode).toBe(40);
  });
});

describe('ScenarioCalibrationAnalyticsService', () => {
  const build = () => {
    const repo = {
      getDataFloor: jest.fn().mockResolvedValue(new Date('2025-01-01')),
      getCalibrationSessions: jest
        .fn()
        .mockResolvedValue([
          session(10, { scenarioId: 7 }),
          session(0, { scenarioId: 8, resolved: false }),
        ]),
      getScoringContributors: jest.fn().mockResolvedValue([]),
      getScoringConfigChangedAt: jest.fn().mockResolvedValue([]),
      getProgressionShapes: jest.fn().mockResolvedValue([]),
    };
    const service = new ScenarioCalibrationAnalyticsService(
      repo as unknown as ScenarioCalibrationAnalyticsRepository,
    );
    return { repo, service };
  };

  it('calibration: reads the config of scenarios with a resolved session, echoes floor and scope', async () => {
    const { repo, service } = build();
    const res = await service.getCalibration({ tenantId: 'acme' });

    expect(repo.getCalibrationSessions).toHaveBeenCalledWith('acme');
    expect(repo.getScoringContributors).toHaveBeenCalledWith([7]);
    expect(repo.getScoringConfigChangedAt).toHaveBeenCalledWith([7]);
    expect(res.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(res.scoping).toEqual({ tenantId: 'acme', unscopedSections: [] });
    expect(res.totals.unresolvedExcluded).toBe(1);
    expect(res.thresholds).toEqual({
      tooEasyTopBandPct: 80,
      tooHardBelowZeroPct: 50,
    });
    expect(res.bandDefinitions.derived).toHaveLength(6);
    expect(res.provenance.derivation).toContain('R2');
    expect(res.provenance.note).toContain('authoring label');
  });

  it('progression: defaults to 90 days by week, platform-wide', async () => {
    const { repo, service } = build();
    const res = await service.getProgression({});

    expect(repo.getDataFloor).not.toHaveBeenCalled();
    const [start, end, bucket, tenantId] =
      repo.getProgressionShapes.mock.calls[0];
    expect(bucket).toBe('week');
    expect(tenantId).toBeUndefined();
    expect((end as Date).getTime() - (start as Date).getTime()).toBe(
      90 * 86_400_000,
    );
    expect(res.window.label).toBe('Last 90 days');
    expect(res.points.length).toBeGreaterThan(0);
    expect(res.scoping.tenantId).toBeNull();
    expect(res.provenance.derivation).toContain('R9');
    expect(res.provenance.note).toContain('score-windowed');
  });

  it('progression: an all-time window starts at the measured data floor', async () => {
    const { repo, service } = build();
    await service.getProgression({ range: 'all', tenantId: 'acme' });
    expect(repo.getDataFloor).toHaveBeenCalled();
    const [start, , bucket, tenantId] = repo.getProgressionShapes.mock.calls[0];
    expect((start as Date).toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(bucket).toBe('month');
    expect(tenantId).toBe('acme');
  });
});
