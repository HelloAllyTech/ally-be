import { FHS_RUBRIC } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  CoverageCut,
  REPEAT_MIN_SPAN_MS,
  RepeatGroupRow,
  SCENARIO_TAG_GAP_THRESHOLDS,
  ScenarioMetaRow,
  ScenarioTagRow,
  buildOpportunityCoverage,
  buildRepeatImprovement,
  isRepeatPair,
  mapScenarioTags,
  resolvedSessionScorePredicate,
  singleScenarioOf,
} from '../scenario-effectiveness.util';

const FLOOR = 20;
const coverageOpts = {
  floor: FLOOR,
  gapMaxPct: SCENARIO_TAG_GAP_THRESHOLDS.maxOpportunityPct,
  gapMinCuts: SCENARIO_TAG_GAP_THRESHOLDS.minCuts,
};

// ─────────────────────────────────────────────────────────────────────────────
// Single-scenario rule
// ─────────────────────────────────────────────────────────────────────────────

describe('singleScenarioOf', () => {
  const sessions = new Map<string, number | null>([
    ['a1', 1],
    ['a2', 1],
    ['b1', 2],
    ['orphan', null],
  ]);

  it('attributes a one-session cut to its scenario', () => {
    expect(singleScenarioOf(['a1'], sessions)).toBe(1);
  });

  it('attributes a multi-session cut when every session played the same scenario', () => {
    expect(singleScenarioOf(['a1', 'a2'], sessions)).toBe(1);
  });

  it('refuses a cut that crosses two scenarios', () => {
    expect(singleScenarioOf(['a1', 'b1'], sessions)).toBeNull();
  });

  it('refuses a cut with a session it cannot find, or one with no scenario', () => {
    expect(singleScenarioOf(['a1', 'gone'], sessions)).toBeNull();
    expect(singleScenarioOf(['orphan'], sessions)).toBeNull();
    expect(singleScenarioOf([], sessions)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tag → rubric skill
// ─────────────────────────────────────────────────────────────────────────────

describe('mapScenarioTags', () => {
  it('maps seeded competency names to rubric keys, in rubric order, once each', () => {
    const out = mapScenarioTags([
      { name: 'Elicitation of Feedback', isCustom: false },
      { name: 'Empathy, Warmth & Genuineness', isCustom: false },
      { name: 'Empathy, Warmth & Genuineness', isCustom: false },
      { name: 'Verbal Communication', isCustom: false },
    ]);
    expect(out.taggedSkills).toEqual(['verbal', 'empathy', 'feedback']);
    expect(out.untranslatableTags).toEqual([]);
    expect(out.customTags).toBe(0);
  });

  it('names the seeded tags with no rubric skill and only counts custom ones', () => {
    const out = mapScenarioTags([
      { name: 'Linking Emotions, Thoughts & Behaviours', isCustom: false },
      { name: 'Non-Verbal Communication', isCustom: false },
      { name: '42_custom_3', isCustom: true },
      { name: 'Assessment of Harm & Response Planning', isCustom: false },
    ]);
    expect(out.taggedSkills).toEqual(['harm']);
    expect(out.untranslatableTags).toEqual([
      'Linking Emotions, Thoughts & Behaviours',
      'Non-Verbal Communication',
    ]);
    // A custom name identifies its owner, never a skill: counted, not listed.
    expect(out.customTags).toBe(1);
    expect(out.untranslatableTags).not.toContain('42_custom_3');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity coverage + tag gaps
// ─────────────────────────────────────────────────────────────────────────────

/** A cut in scenario `scenario`'s own session, with opportunities for `skills`. */
let sessionSeq = 0;
const scenarioBySession = new Map<string, number | null>();
const cutIn = (scenario: number, skills: string[], userId = 1): CoverageCut => {
  sessionSeq += 1;
  const id = `s${sessionSeq}`;
  scenarioBySession.set(id, scenario);
  return {
    userId,
    levels: Object.fromEntries(skills.map((k) => [k, 3])),
    sessionIds: [id],
  };
};

const meta: ScenarioMetaRow[] = [
  { scenarioId: 1, title: 'Grief', sessionsPlayed: 40 },
  { scenarioId: 2, title: 'Low mood', sessionsPlayed: 90 },
  { scenarioId: 3, title: 'Thin', sessionsPlayed: 6 },
];
const tags: ScenarioTagRow[] = [
  {
    scenarioId: 1,
    name: 'Assessment of Harm & Response Planning',
    isCustom: false,
  },
  { scenarioId: 1, name: 'Empathy, Warmth & Genuineness', isCustom: false },
  { scenarioId: 2, name: 'Promote Realistic Hope', isCustom: false },
  {
    scenarioId: 2,
    name: 'Linking Emotions, Thoughts & Behaviours',
    isCustom: false,
  },
];

describe('buildOpportunityCoverage', () => {
  // Scenario 1: 20 cuts from 10 learners, harm in 5 (25%: a gap), empathy in 12
  // (60%: fine), feelings in 2 (10% but untagged: not a gap).
  const s1 = Array.from({ length: 20 }, (_, i) =>
    cutIn(
      1,
      [
        'verbal',
        ...(i < 5 ? ['harm'] : []),
        ...(i < 12 ? ['empathy'] : []),
        ...(i < 2 ? ['feelings'] : []),
      ],
      1 + (i % 10),
    ),
  );
  // Scenario 2: 25 cuts, hope in 5 (20%: a gap).
  const s2 = Array.from({ length: 25 }, (_, i) =>
    cutIn(2, ['verbal', ...(i < 5 ? ['hope'] : [])], 100 + i),
  );
  // Scenario 3: 4 cuts — under the floor.
  const s3 = Array.from({ length: 4 }, () => cutIn(3, ['verbal']));
  // A cut across scenarios 1 and 2, and one whose session is gone.
  const mixedA = cutIn(1, ['verbal']);
  const mixedB = cutIn(2, ['verbal']);
  const mixed: CoverageCut = {
    userId: 7,
    levels: { verbal: 3, harm: 2 },
    sessionIds: [...mixedA.sessionIds, ...mixedB.sessionIds],
  };
  const orphan: CoverageCut = {
    userId: 8,
    levels: { verbal: 3 },
    sessionIds: ['missing-session'],
  };
  const cuts = [...s1, ...s2, ...s3, mixed, orphan];
  const out = buildOpportunityCoverage(
    cuts,
    scenarioBySession,
    meta,
    tags,
    coverageOpts,
  );

  it('counts only single-scenario cuts, and reports their share of every scored cut', () => {
    expect(out.scoredCuts).toBe(51);
    expect(out.singleScenarioCuts).toBe(49);
    expect(out.singleScenarioShare).toBe(96.1);
  });

  it('gives scenarios at the floor a row, most cuts first, and lists the rest with n', () => {
    expect(out.scenarios.map((r) => [r.scenarioId, r.cuts])).toEqual([
      [2, 25],
      [1, 20],
    ]);
    expect(out.belowFloor).toEqual([{ scenarioId: 3, title: 'Thin', cuts: 4 }]);
  });

  it('fills one cell per rubric skill with the share of cuts that had an opportunity', () => {
    const row = out.scenarios.find((r) => r.scenarioId === 1)!;
    expect(row.cells.map((c) => c.skill)).toEqual(FHS_RUBRIC.map((s) => s.key));
    const cell = (k: string) => row.cells.find((c) => c.skill === k)!;
    expect(cell('verbal')).toEqual({
      skill: 'verbal',
      tagged: false,
      opportunities: 20,
      opportunityPct: 100,
    });
    expect(cell('harm')).toMatchObject({
      tagged: true,
      opportunities: 5,
      opportunityPct: 25,
    });
    expect(cell('empathy')).toMatchObject({ tagged: true, opportunityPct: 60 });
    expect(cell('goals')).toMatchObject({
      opportunities: 0,
      opportunityPct: 0,
    });
    expect(row.learners).toBe(10);
    expect(row.sessionsPlayed).toBe(40);
    expect(row.taggedSkills).toEqual(['empathy', 'harm']);
  });

  it('carries the tags that map to no skill', () => {
    const row = out.scenarios.find((r) => r.scenarioId === 2)!;
    expect(row.taggedSkills).toEqual(['hope']);
    expect(row.untranslatableTags).toEqual([
      'Linking Emotions, Thoughts & Behaviours',
    ]);
  });

  it('flags tagged skills under 30% as gaps, most-played scenario first, never an untagged one', () => {
    expect(
      out.tagGaps.map((g) => [g.scenarioId, g.skill, g.opportunityPct]),
    ).toEqual([
      [2, 'hope', 20],
      [1, 'harm', 25],
    ]);
    expect(out.tagGaps[0]).toEqual({
      scenarioId: 2,
      title: 'Low mood',
      skill: 'hope',
      opportunityPct: 20,
      cuts: 25,
      sessionsPlayed: 90,
    });
    // feelings sits at 10% in scenario 1 but nobody tagged it.
    expect(out.tagGaps.some((g) => g.skill === 'feelings')).toBe(false);
  });

  it('withholds the single-scenario share below the floor, and is empty on no data', () => {
    const thin = buildOpportunityCoverage(
      s3,
      scenarioBySession,
      meta,
      tags,
      coverageOpts,
    );
    expect(thin.singleScenarioShare).toBeNull();
    expect(thin.scenarios).toEqual([]);
    expect(thin.belowFloor).toHaveLength(1);

    const empty = buildOpportunityCoverage([], new Map(), [], [], coverageOpts);
    expect(empty).toEqual({
      scoredCuts: 0,
      singleScenarioCuts: 0,
      singleScenarioShare: null,
      scenarios: [],
      belowFloor: [],
      tagGaps: [],
    });
  });

  it('needs the gap minimum of cuts even when a row clears a lower floor', () => {
    const lowFloor = buildOpportunityCoverage(
      s3.map((c) => ({ ...c, levels: { verbal: 3 } })),
      scenarioBySession,
      meta,
      [{ scenarioId: 3, name: 'Promote Realistic Hope', isCustom: false }],
      { ...coverageOpts, floor: 2 },
    );
    expect(lowFloor.scenarios).toHaveLength(1);
    expect(lowFloor.tagGaps).toEqual([]);
  });

  it('falls back to a placeholder title for a scenario it has no row for', () => {
    const lone = Array.from({ length: 20 }, () => cutIn(99, ['verbal']));
    const res = buildOpportunityCoverage(
      lone,
      scenarioBySession,
      [],
      [],
      coverageOpts,
    );
    expect(res.scenarios[0]).toMatchObject({
      scenarioId: 99,
      title: 'Untitled scenario',
      sessionsPlayed: 0,
      taggedSkills: [],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Repeat improvement
// ─────────────────────────────────────────────────────────────────────────────

describe('resolvedSessionScorePredicate', () => {
  it('drops only a 0 with no detected event, on the given alias', () => {
    const sql = resolvedSessionScorePredicate('ss');
    expect(sql).toBe(
      'NOT (ss.score = 0 AND NOT EXISTS (SELECT 1 FROM scenario_session_events rse ' +
        'WHERE rse."scenarioSessionId" = ss.id))',
    );
  });
});

const T0 = Date.UTC(2026, 6, 1);
const hours = (h: number) => new Date(T0 + h * 3_600_000);

const group = (
  userId: number,
  first: number,
  latest: number,
  extra: Partial<RepeatGroupRow> = {},
): RepeatGroupRow => ({
  userId,
  scenarioId: 10,
  title: 'Panic attack',
  versionId: 'v-a',
  versionNumber: 2,
  plays: 3,
  firstScore: first,
  firstAt: hours(0),
  latestScore: latest,
  latestAt: hours(48),
  ...extra,
});

describe('isRepeatPair', () => {
  it('needs 2+ plays at least a day apart', () => {
    expect(
      isRepeatPair({ plays: 2, firstAt: hours(0), latestAt: hours(24) }),
    ).toBe(true);
    expect(
      isRepeatPair({ plays: 2, firstAt: hours(0), latestAt: hours(23.9) }),
    ).toBe(false);
    expect(
      isRepeatPair({ plays: 1, firstAt: hours(0), latestAt: hours(48) }),
    ).toBe(false);
    expect(REPEAT_MIN_SPAN_MS).toBe(86_400_000);
  });
});

describe('buildRepeatImprovement', () => {
  it('pairs first vs latest per scenario version, with a paired CI above the floor', () => {
    const groups = Array.from({ length: 20 }, (_, i) =>
      group(i + 1, 40 + i, 45 + i + (i % 2)),
    );
    const out = buildRepeatImprovement(groups, { floor: FLOOR });
    expect(out.repeatGroups).toBe(20);
    expect(out.scenarios).toHaveLength(1);
    const row = out.scenarios[0];
    expect(row).toMatchObject({
      scenarioId: 10,
      versionId: 'v-a',
      versionNumber: 2,
      repeaters: 20,
      pairs: 20,
      firstAvg: 49.5,
      latestAvg: 55,
      change: 5.5,
      up: 20,
      down: 0,
      tied: 0,
      detectable: true,
    });
    expect(row.changeCi![0]).toBeGreaterThan(0);
    expect(row.signP).toBeLessThan(0.001);
  });

  it('counts same-day replays as repeaters but never as pairs', () => {
    const groups = [group(1, 10, 50, { latestAt: hours(5) }), group(2, 10, 50)];
    const row = buildRepeatImprovement(groups, { floor: FLOOR }).scenarios[0];
    expect(row.repeaters).toBe(2);
    expect(row.pairs).toBe(1);
  });

  it('withholds averages, CI and test below the floor while the counts travel', () => {
    const groups = Array.from({ length: 5 }, (_, i) => group(i + 1, 10, 20));
    const row = buildRepeatImprovement(groups, { floor: FLOOR }).scenarios[0];
    expect(row).toMatchObject({
      pairs: 5,
      firstAvg: null,
      latestAvg: null,
      change: null,
      changeCi: null,
      signP: null,
      detectable: false,
      up: 5,
    });
  });

  it('never pairs across versions — a version change starts a new pairing', () => {
    const groups = [
      group(1, 10, 20, { versionId: 'v-a', versionNumber: 1 }),
      group(1, 60, 70, { versionId: 'v-b', versionNumber: 2 }),
      group(2, 10, 20, { versionId: null, versionNumber: null }),
    ];
    const out = buildRepeatImprovement(groups, { floor: FLOOR });
    expect(out.scenarios.map((r) => [r.versionId, r.pairs])).toEqual(
      expect.arrayContaining([
        ['v-a', 1],
        ['v-b', 1],
        [null, 1],
      ]),
    );
    expect(out.scenarios).toHaveLength(3);
  });

  it('pools scale-free: one vote per learner, by the balance of their pairs, not their points', () => {
    const groups = [
      // Learner 1: +2 on a small-scale scenario, −30 on a large one → no net
      // direction (a points average would have called them "down").
      group(1, 10, 12, { scenarioId: 1 }),
      group(1, 100, 70, { scenarioId: 2 }),
      // Learner 2: up on two scenarios, down on one → up.
      group(2, 10, 11, { scenarioId: 1 }),
      group(2, 10, 11, { scenarioId: 2 }),
      group(2, 100, 50, { scenarioId: 3 }),
      // Learner 3: down.
      group(3, 20, 10, { scenarioId: 1 }),
    ];
    const pooled = buildRepeatImprovement(groups, { floor: 2 }).pooled;
    expect(pooled).toMatchObject({
      pairs: 6,
      learners: 3,
      up: 1,
      down: 1,
      tied: 1,
      improvingPct: 50,
    });
    expect(pooled.signP).toBe(1);
  });

  it('withholds the pooled share and test below the floor of learners', () => {
    const pooled = buildRepeatImprovement([group(1, 10, 20)], {
      floor: FLOOR,
    }).pooled;
    expect(pooled).toMatchObject({
      learners: 1,
      up: 1,
      improvingPct: null,
      signP: null,
    });
  });

  it('defaults the slope chart to the scenario with most pairs, on its best version', () => {
    const groups = [
      ...Array.from({ length: 20 }, (_, i) =>
        group(i + 1, 30, 30 + (i % 3) - 1, { scenarioId: 5, title: 'Busy' }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        group(i + 1, 30, 35, {
          scenarioId: 5,
          title: 'Busy',
          versionId: 'old',
          versionNumber: 1,
        }),
      ),
      group(1, 10, 20, { scenarioId: 6, title: 'Quiet' }),
    ];
    const out = buildRepeatImprovement(groups, { floor: FLOOR });
    expect(out.picker).toEqual([
      { scenarioId: 5, title: 'Busy', versionId: 'v-a', pairs: 20 },
      { scenarioId: 6, title: 'Quiet', versionId: 'v-a', pairs: 1 },
    ]);
    const sel = out.selected!;
    expect(sel).toMatchObject({ scenarioId: 5, versionId: 'v-a', pairs: 20 });
    expect(sel.learners).toHaveLength(20);
    // Sorted by own change, biggest rise first — never by level.
    const changes = sel.learners!.map((l) => l.change);
    expect(changes).toEqual([...changes].sort((a, b) => b - a));
    expect(sel.learners![0]).toEqual({
      learnerId: expect.any(Number),
      first: 30,
      latest: 31,
      change: 1,
      firstAt: hours(0).toISOString(),
      latestAt: hours(48).toISOString(),
      plays: 3,
    });
    expect(Object.keys(sel.learners![0])).not.toContain('name');
  });

  it('honours an explicit scenarioId, carrying counts only below the floor', () => {
    const groups = [
      ...Array.from({ length: 20 }, (_, i) =>
        group(i + 1, 30, 31, { scenarioId: 5 }),
      ),
      group(1, 10, 20, { scenarioId: 6, title: 'Quiet' }),
    ];
    const sel = buildRepeatImprovement(groups, {
      floor: FLOOR,
      scenarioId: 6,
    }).selected;
    expect(sel).toEqual({
      scenarioId: 6,
      title: 'Quiet',
      versionId: 'v-a',
      versionNumber: 2,
      repeaters: 1,
      pairs: 1,
      learners: null,
    });

    const none = buildRepeatImprovement(groups, {
      floor: FLOOR,
      scenarioId: 404,
    }).selected;
    expect(none).toEqual({
      scenarioId: 404,
      title: null,
      versionId: null,
      versionNumber: null,
      repeaters: 0,
      pairs: 0,
      learners: null,
    });
  });

  it('caps the picker and returns empty structures with no data', () => {
    const groups = Array.from({ length: 12 }, (_, i) =>
      group(1, 10, 20, { scenarioId: i + 1, title: `S${i + 1}` }),
    );
    expect(
      buildRepeatImprovement(groups, { floor: FLOOR }).picker,
    ).toHaveLength(10);

    expect(buildRepeatImprovement([], { floor: FLOOR })).toEqual({
      repeatGroups: 0,
      scenarios: [],
      pooled: {
        pairs: 0,
        learners: 0,
        up: 0,
        down: 0,
        tied: 0,
        improvingPct: null,
        signP: null,
      },
      selected: null,
      picker: [],
    });
  });
});
