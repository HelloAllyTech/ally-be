import type { FoundationalSkillsLearnerCutRow } from '../../repository/foundational-skills-analytics.repository';
import { groupCutRows } from '../effectiveness.util';
import {
  ORG_SPARK_MIN_CUTS,
  OrgEnrolmentRow,
  OrgTenant,
  buildCostPerImprovement,
  buildOrgScorecard,
  median,
  sparkMonthsEnding,
  tenantAliasMap,
  windowBounds,
} from '../effectiveness-orgs.util';
import { cutNoiseSd, learnerTrend } from '../foundational-skills-progress.util';

const FLOOR = 20;
const COHORT = 5;
const NOW = new Date('2026-10-05T12:00:00.000Z');

const ORG_A: OrgTenant = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Alpha',
  code: 'alpha',
};
const ORG_B: OrgTenant = {
  id: 'bbbbbbbb-0000-4000-8000-000000000002',
  name: 'Beta',
  code: 'beta',
};
const ORG_C: OrgTenant = {
  id: 'cccccccc-0000-4000-8000-000000000003',
  name: 'Gamma',
  code: null,
};
const ORG_EMPTY: OrgTenant = {
  id: 'dddddddd-0000-4000-8000-000000000004',
  name: 'Empty',
  code: 'empty',
};

type CutOpts = {
  unhelpful?: boolean | null;
  closedAt?: Date;
  harm?: 'followed' | 'missed' | 'ambiguous';
};

function cutRow(
  userId: number,
  cut: number,
  score: number,
  tenantId: string | null,
  opts: CutOpts = {},
): FoundationalSkillsLearnerCutRow {
  const levels: Record<string, number> = { verbal: 3 };
  const verdicts: FoundationalSkillsLearnerCutRow['verdicts'] = [];
  if (opts.harm) {
    levels.harm = 3;
    const observed =
      opts.harm === 'followed'
        ? ['harm.b1']
        : opts.harm === 'missed'
          ? ['harm.u1']
          : ['harm.b1', 'harm.u1'];
    verdicts.push({ skill: 'harm', level: 3, observed });
  }
  return {
    userId,
    name: null,
    tenantId,
    cut,
    closedAt: opts.closedAt ?? new Date('2026-09-15T10:00:00.000Z'),
    score,
    unhelpful: opts.unhelpful === undefined ? false : opts.unhelpful,
    levels,
    verdicts,
    sessionIds: [`s-${userId}-${cut}`],
  };
}

/** One learner: cuts 1..n with the given scores, all in one tenant. */
function learner(
  userId: number,
  tenantId: string | null,
  scores: number[],
  opts: (i: number) => CutOpts = () => ({}),
  firstCut = 1,
): FoundationalSkillsLearnerCutRow[] {
  return scores.map((s, i) =>
    cutRow(userId, firstCut + i, s, tenantId, opts(i)),
  );
}

/** `count` learners in `tenantId`, ids from `startId`, same scores each. */
function many(
  count: number,
  startId: number,
  tenantId: string | null,
  scores: number[],
  opts?: (i: number) => CutOpts,
): FoundationalSkillsLearnerCutRow[] {
  return Array.from({ length: count }, (_, k) =>
    learner(startId + k, tenantId, scores, opts),
  ).flat();
}

const enrol = (
  tenantRef: string | null,
  started: number,
  completed: number,
  learnersStarted = started,
): OrgEnrolmentRow => ({ tenantRef, started, completed, learnersStarted });

const build = (
  rows: FoundationalSkillsLearnerCutRow[],
  extra: {
    enrolments?: OrgEnrolmentRow[];
    tenants?: OrgTenant[];
    tenantId?: string;
  } = {},
) =>
  buildOrgScorecard({
    rows,
    tenants: extra.tenants ?? [ORG_A, ORG_B, ORG_C, ORG_EMPTY],
    enrolments: extra.enrolments ?? [],
    now: NOW,
    sampleFloor: FLOOR,
    minCohort: COHORT,
    tenantId: extra.tenantId,
  });

describe('tenantAliasMap', () => {
  it('maps a tenant’s uuid and its code to the uuid', () => {
    const m = tenantAliasMap([ORG_A, ORG_C]);
    expect(m.get(ORG_A.id)).toBe(ORG_A.id);
    expect(m.get('alpha')).toBe(ORG_A.id);
    expect(m.get(ORG_C.id)).toBe(ORG_C.id);
    expect(m.size).toBe(3);
  });
});

describe('median / sparkMonthsEnding', () => {
  it('interpolates like percentile_cont and is null for nothing', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('ends with the month that contains now, oldest first, across a year boundary', () => {
    expect(sparkMonthsEnding(new Date('2026-02-10T00:00:00Z'), 4)).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
    expect(sparkMonthsEnding(NOW)).toHaveLength(6);
  });
});

describe('buildOrgScorecard — attribution', () => {
  it('puts cuts tagged with an org’s uuid and with its code on ONE row', () => {
    const rows = [
      ...learner(1, ORG_A.id, [2, 2, 3, 3]),
      ...learner(2, 'alpha', [2, 2, 3, 3]),
      // One learner whose cuts carry both spellings.
      cutRow(3, 1, 2, ORG_A.id),
      cutRow(3, 2, 2, 'alpha'),
    ];
    const out = build(rows);
    expect(out.orgs).toHaveLength(1);
    const [a] = out.orgs;
    expect(a.tenantId).toBe(ORG_A.id);
    expect(a.code).toBe('alpha');
    expect(a.scoredLearners).toBe(3);
    expect(a.measurableLearners).toBe(3);
    expect(a.classifiableLearners).toBe(2);
    expect(a.scoredCuts).toBe(10);
  });

  it('credits a learner who moved orgs only with the cuts that closed in each', () => {
    const rows = [
      ...learner(1, ORG_A.id, [2, 2, 2]),
      ...learner(1, ORG_B.id, [3, 3, 3, 3], () => ({}), 4),
    ];
    const out = build(rows);
    const a = out.orgs.find((o) => o.tenantId === ORG_A.id)!;
    const b = out.orgs.find((o) => o.tenantId === ORG_B.id)!;
    expect(a.scoredCuts).toBe(3);
    expect(a.classifiableLearners).toBe(0);
    expect(b.scoredCuts).toBe(4);
    expect(b.classifiableLearners).toBe(1);
    // The platform row sees the learner's whole series.
    expect(out.platform.scoredCuts).toBe(7);
    expect(out.platform.classifiableLearners).toBe(1);
  });

  it('counts cuts with no tenant or a non-live tenant in summary, never in a row', () => {
    const rows = [
      ...learner(1, ORG_A.id, [2, 2]),
      ...learner(2, null, [2, 3]),
      ...learner(3, 'deleted-org', [3]),
    ];
    const out = build(rows);
    expect(out.orgs.map((o) => o.tenantId)).toEqual([ORG_A.id]);
    expect(out.summary).toEqual({
      orgs: 4,
      orgsWithData: 1,
      orgsAboveFloor: 0,
      cutsUnattributed: 3,
      learnersUnattributed: 2,
    });
    expect(out.platform.scoredCuts).toBe(5);
  });

  it('gives an org a row once it has a scored cut or a started enrolment, and no sooner', () => {
    const out = build([...learner(1, ORG_A.id, [2, 2])], {
      enrolments: [enrol('beta', 3, 1), enrol(ORG_EMPTY.id, 0, 0)],
    });
    expect(out.orgs.map((o) => o.tenantName).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('sorts by measurable learners, never by a rate', () => {
    const rows = [
      ...many(3, 100, ORG_C.id, [1, 1, 1, 1]),
      ...many(5, 200, ORG_A.id, [3, 3]),
      ...many(4, 300, ORG_B.id, [4, 4, 4, 4]),
    ];
    expect(build(rows).orgs.map((o) => o.tenantName)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('narrows rows to one org by uuid or code; noise, platform and summary stay platform-wide', () => {
    const rows = [
      ...many(3, 100, ORG_A.id, [2, 2, 3, 3]),
      ...many(3, 200, ORG_B.id, [1, 4, 1, 4]),
    ];
    const all = build(rows);
    const byCode = build(rows, { tenantId: 'beta' });
    const byId = build(rows, { tenantId: ORG_B.id });
    expect(byCode.orgs.map((o) => o.tenantId)).toEqual([ORG_B.id]);
    expect(byId.orgs).toEqual(byCode.orgs);
    expect(byCode.cutNoiseSd).toBe(all.cutNoiseSd);
    expect(byCode.platform).toEqual(all.platform);
    expect(byCode.summary).toEqual(all.summary);
  });
});

describe('buildOrgScorecard — floors and the platform band', () => {
  const improving = [2, 2.1, 2.9, 3];

  it('below the floor: counts travel, every rate, change and spark value is null', () => {
    const rows = many(19, 1, ORG_A.id, improving);
    const [a] = build(rows, { enrolments: [enrol('alpha', 40, 30)] }).orgs;
    expect(a.measurableLearners).toBe(19);
    expect(a.belowFloor).toBe(true);
    expect(a.composite.learners).toBe(19);
    expect(a.composite.change).toBeNull();
    expect(a.composite.ci).toBeNull();
    expect(a.composite.detectable).toBe(false);
    expect(a.trend.improving).toBe(19);
    expect(a.trend.improvingPct).toBeNull();
    expect(a.courses).toEqual({
      learnersStarted: 40,
      started: 40,
      completed: 30,
      completionPct: null,
    });
    expect(a.spark.every((v) => v === null)).toBe(true);
    expect(a.sparkCuts[a.sparkCuts.length - 2]).toBe(19 * 4);
  });

  it('at the floor: the composite change is each learner’s own learnerTrend change, paired', () => {
    const rows = many(20, 1, ORG_A.id, improving);
    const out = build(rows, { enrolments: [enrol(ORG_A.id, 25, 10)] });
    const [a] = out.orgs;
    expect(a.belowFloor).toBe(false);
    const noise = cutNoiseSd(groupCutRows(rows));
    const own = learnerTrend(groupCutRows(rows)[0], noise).change as number;
    expect(a.composite.change).toBeCloseTo(own, 2);
    expect(a.composite.earlyAvg).toBe(2.05);
    expect(a.composite.lateAvg).toBe(2.95);
    expect(a.composite.up).toBe(20);
    // Every learner moved the same +0.9, so the interval is that point: a move.
    expect(a.composite.ci).toEqual([0.9, 0.9]);
    expect(a.composite.detectable).toBe(true);
    expect(a.trend).toMatchObject({
      classifiable: 20,
      improving: 20,
      improvingPct: 100,
      steadyPct: 0,
    });
    expect(a.courses.completionPct).toBe(40);
    expect(out.summary.orgsAboveFloor).toBe(1);
  });

  it('holds every org to the PLATFORM noise band, not its own', () => {
    // Beta's own slices barely move (own noise 0 → every rise "improving");
    // Gamma's swing wildly, which widens the platform band past Beta's rise.
    const beta = many(4, 100, ORG_B.id, [2, 2.1, 2.2, 2.3]);
    const gamma = many(4, 200, ORG_C.id, [1, 4, 1, 4]);
    const alone = build(beta).orgs[0];
    expect(alone.trend.improving).toBe(4);

    const out = build([...beta, ...gamma]);
    const b = out.orgs.find((o) => o.tenantId === ORG_B.id)!;
    expect(b.trend.improving).toBe(0);
    expect(b.trend.steady).toBe(4);
    expect(out.cutNoiseSd).toBeGreaterThan(0.5);
  });

  it('reports the unhelpful change in percentage points of each learner’s slices', () => {
    // First half: 1 of 2 slices unhelpful (50%); last half: 0 of 2 (0%).
    const rows = many(20, 1, ORG_A.id, improving, (i) => ({
      unhelpful: i === 0,
    }));
    const [a] = build(rows).orgs;
    expect(a.unhelpful.learners).toBe(20);
    expect(a.unhelpful.earlyAvg).toBe(50);
    expect(a.unhelpful.lateAvg).toBe(0);
    expect(a.unhelpful.change).toBe(-50);
    expect(a.unhelpful.down).toBe(20);
  });

  it('leaves a learner out of the unhelpful pairing when a half carries no flag', () => {
    const rows = many(20, 1, ORG_A.id, improving, (i) => ({
      unhelpful: i < 2 ? null : false,
    }));
    const [a] = build(rows).orgs;
    expect(a.unhelpful.learners).toBe(0);
    expect(a.unhelpful.change).toBeNull();
    expect(a.composite.learners).toBe(20);
  });

  it('withholds course completion under the floor of started enrolments', () => {
    const rows = many(20, 1, ORG_A.id, improving);
    const [a] = build(rows, {
      enrolments: [enrol(ORG_A.id, 12, 6), enrol('alpha', 7, 3)],
    }).orgs;
    // uuid and code spellings summed: 19 started < 20.
    expect(a.courses.started).toBe(19);
    expect(a.courses.completed).toBe(9);
    expect(a.courses.completionPct).toBeNull();
  });
});

describe('buildOrgScorecard — self-harm follow-up (internal)', () => {
  const improving = [2, 2.1, 2.9, 3];

  it('is followed ÷ (followed + missed) cuts, unclear cuts left out', () => {
    // 20 measurable learners; 6 meet a cue: 3 followed, 2 missed, 1 unclear.
    const plain = many(14, 1, ORG_A.id, improving);
    const cue = (state: 'followed' | 'missed' | 'ambiguous', id: number) =>
      learner(id, ORG_A.id, improving, (i) => (i === 0 ? { harm: state } : {}));
    const rows = [
      ...plain,
      ...cue('followed', 101),
      ...cue('followed', 102),
      ...cue('followed', 103),
      ...cue('missed', 104),
      ...cue('missed', 105),
      ...cue('ambiguous', 106),
    ];
    const [a] = build(rows).orgs;
    expect(a.selfHarm).toEqual({
      internal: true,
      learnersWithCue: 6,
      cutsWithCue: 6,
      cutsFollowedUp: 3,
      cutsMissed: 2,
      cutsAmbiguous: 1,
      followedUpPct: 60,
    });
  });

  it('is withheld below minCohort learners with a cue, and on a below-floor row', () => {
    const cue = (id: number, tenant: string) =>
      learner(id, tenant, improving, (i) =>
        i === 0 ? { harm: 'followed' } : {},
      );
    const few = [
      ...many(16, 1, ORG_A.id, improving),
      ...[101, 102, 103, 104].flatMap((id) => cue(id, ORG_A.id)),
    ];
    const [a] = build(few).orgs;
    expect(a.selfHarm.learnersWithCue).toBe(4);
    expect(a.selfHarm.cutsFollowedUp).toBe(4);
    expect(a.selfHarm.followedUpPct).toBeNull();

    const small = [101, 102, 103, 104, 105].flatMap((id) => cue(id, ORG_B.id));
    const [b] = build(small).orgs;
    expect(b.belowFloor).toBe(true);
    expect(b.selfHarm.learnersWithCue).toBe(5);
    expect(b.selfHarm.followedUpPct).toBeNull();
  });
});

describe('buildOrgScorecard — sparkline', () => {
  it('draws the median composite per month of cut close, null below the cut floor', () => {
    const sept = new Date('2026-09-20T00:00:00Z');
    const aug = new Date('2026-08-03T00:00:00Z');
    const rows = Array.from({ length: 20 }, (_, k) =>
      learner(k + 1, ORG_A.id, [2, 3], (i) => ({
        closedAt: i === 0 ? sept : new Date('2026-10-01T00:00:00Z'),
      })),
    ).flat();
    // Four cuts in August: below ORG_SPARK_MIN_CUTS.
    rows.push(
      ...learner(500, ORG_A.id, [1, 1, 1, 1], () => ({ closedAt: aug })),
    );
    const out = build(rows);
    const [a] = out.orgs;
    expect(out.months).toEqual([
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ]);
    expect(ORG_SPARK_MIN_CUTS).toBe(5);
    expect(a.sparkCuts).toEqual([0, 0, 0, 4, 20, 20]);
    expect(a.spark).toEqual([null, null, null, null, 2, 3]);
  });
});

describe('windowBounds', () => {
  it('turns the echoed inclusive window into [start, endExclusive)', () => {
    expect(windowBounds({ from: '2026-09-01', to: '2026-09-30' })).toEqual({
      start: new Date('2026-09-01T00:00:00.000Z'),
      endExclusive: new Date('2026-10-01T00:00:00.000Z'),
    });
  });
});

describe('buildCostPerImprovement', () => {
  const start = new Date('2026-09-01T00:00:00.000Z');
  const endExclusive = new Date('2026-10-01T00:00:00.000Z');
  const inside = new Date('2026-09-10T00:00:00.000Z');
  const before = new Date('2026-08-31T23:59:59.000Z');
  const improving = [2, 2.1, 2.9, 3];

  /** A learner whose LAST cut closes at `last`; earlier cuts well before. */
  const withLast = (id: number, scores: number[], last: Date) =>
    learner(id, ORG_A.id, scores, (i) => ({
      closedAt:
        i === scores.length - 1 ? last : new Date('2026-06-01T00:00:00Z'),
    }));

  it('counts improving learners whose last scored cut closed inside the window', () => {
    const rows = [
      ...withLast(1, improving, inside),
      ...withLast(2, improving, before),
      ...withLast(3, improving, endExclusive), // exclusive bound
      ...withLast(4, improving, start), // inclusive bound
      ...withLast(5, [2.5, 2.5, 2.5, 2.5], inside), // steady
      ...withLast(6, [2, 3], inside), // too early to classify
    ];
    const out = buildCostPerImprovement({
      rows,
      start,
      endExclusive,
      spendUsd: 123.456,
      sampleFloor: 1,
    });
    expect(out.improvedLearners).toBe(2);
    expect(out.classifiedLearners).toBe(3);
    expect(out.improvingAllTime).toBe(4);
    expect(out.classifiableAllTime).toBe(5);
    expect(out.measuredLearners).toBe(6);
    expect(out.spendUsd).toBe(123.46);
    expect(out.costPerImprovedLearnerUsd).toBe(61.73);
  });

  it('withholds the ratio below the floor of improved learners; both sides travel', () => {
    const rows = Array.from({ length: 19 }, (_, k) =>
      withLast(k + 1, improving, inside),
    ).flat();
    const out = buildCostPerImprovement({
      rows,
      start,
      endExclusive,
      spendUsd: 50,
      sampleFloor: FLOOR,
    });
    expect(out.improvedLearners).toBe(19);
    expect(out.spendUsd).toBe(50);
    expect(out.costPerImprovedLearnerUsd).toBeNull();

    const twenty = buildCostPerImprovement({
      rows: [...rows, ...withLast(20, improving, inside)],
      start,
      endExclusive,
      spendUsd: 50,
      sampleFloor: FLOOR,
    });
    expect(twenty.costPerImprovedLearnerUsd).toBe(2.5);
  });

  it('is null, never zero or infinite, with no improved learner', () => {
    const out = buildCostPerImprovement({
      rows: [],
      start,
      endExclusive,
      spendUsd: 10,
      sampleFloor: 0,
    });
    expect(out.improvedLearners).toBe(0);
    expect(out.costPerImprovedLearnerUsd).toBeNull();
    expect(out.cutNoiseSd).toBeNull();
  });
});
