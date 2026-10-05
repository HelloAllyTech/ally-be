import { currentSelfEfficacyInstrument } from 'src/foundational-skills/constants/self-efficacy-instrument.constants';

import {
  SelfEfficacyAnswer,
  SelfEfficacyCut,
  averageRanks,
  buildSelfEfficacy,
  byLearner,
  calibrationStats,
  classifyCalibration,
  confidenceChange,
  matchObservations,
  nearestCut,
  overallPerLearner,
  rescaleSelfRating,
  spearman,
} from '../self-efficacy.util';

const BASE = new Date('2026-06-01T00:00:00Z').getTime();
const day = (d: number) => new Date(BASE + d * 86400000);

const ans = (
  userId: number,
  d: number,
  responses: Record<string, number>,
  trigger = 'CUTS',
): SelfEfficacyAnswer => ({
  userId,
  trigger,
  answeredAt: day(d),
  responses,
});

const cut = (
  userId: number,
  d: number,
  levels: Record<string, number>,
): SelfEfficacyCut => ({ userId, closedAt: day(d), levels });

const instrument = currentSelfEfficacyInstrument();

describe('scale and classification', () => {
  it('puts 0–10 on the rubric’s 1–4 scale', () => {
    expect(rescaleSelfRating(0)).toBe(1);
    expect(rescaleSelfRating(10)).toBe(4);
    expect(rescaleSelfRating(5)).toBe(2.5);
  });

  it('classifies a gap strictly beyond ±0.75 levels', () => {
    expect(classifyCalibration(0.76)).toBe('overConfident');
    expect(classifyCalibration(0.75)).toBe('calibrated');
    expect(classifyCalibration(0)).toBe('calibrated');
    expect(classifyCalibration(-0.75)).toBe('calibrated');
    expect(classifyCalibration(-0.76)).toBe('underConfident');
  });
});

describe('averageRanks / spearman', () => {
  it('gives ties the mean of the positions they span', () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(averageRanks([3, 3, 3])).toEqual([2, 2, 2]);
  });

  it('is 1 / −1 for monotone pairs and handles ties', () => {
    const xs = [0, 1, 2, 3, 4, 5];
    expect(spearman(xs, [1, 1, 2, 3, 3, 4], 2)).toBeCloseTo(0.971, 3);
    expect(spearman(xs, [6, 5, 4, 3, 2, 1], 2)).toBeCloseTo(-1, 10);
  });

  it('withholds below the point floor and when a side does not vary', () => {
    expect(spearman([1, 2, 3], [1, 2, 3], 30)).toBeNull();
    expect(spearman([1, 2, 3, 4], [2, 2, 2, 2], 2)).toBeNull();
  });
});

describe('nearestCut', () => {
  const cuts = [
    cut(1, 0, { verbal: 2 }),
    cut(1, 20, {}),
    cut(1, 40, { verbal: 3 }),
  ];
  const assessable = (c: SelfEfficacyCut) => 'verbal' in c.levels;

  it('takes the closest cut where the skill was assessable', () => {
    // Day 21: the day-20 cut is closer but had no verbal opportunity.
    expect(nearestCut(cuts, day(21), assessable)?.closedAt).toEqual(day(40));
  });

  it('ignores cuts beyond the window either side', () => {
    expect(nearestCut(cuts, day(75), assessable)).toBeNull();
    expect(nearestCut(cuts, day(-31), assessable)).toBeNull();
    expect(nearestCut(cuts, day(-30), assessable)?.closedAt).toEqual(day(0));
  });

  it('breaks a tie towards the earlier cut', () => {
    expect(nearestCut(cuts, day(20), assessable)?.closedAt).toEqual(day(0));
  });
});

describe('confidenceChange (EFF-71)', () => {
  const engage = ['verbal', 'harm'];

  it('pairs first vs latest over the items rated both times', () => {
    const answers = byLearner(
      [
        ans(1, 0, { verbal: 4, harm: 2 }),
        ans(1, 10, { goals: 9 }), // no engage item: not a side for this tier
        ans(1, 50, { verbal: 8 }), // harm skipped: drops out of both sides
        ans(2, 0, { verbal: 5 }), // one answer only: not paired
      ],
      (a) => a.answeredAt,
    );
    const result = confidenceChange(answers, new Map(), engage, 1);
    expect(result.learners).toBe(1);
    expect(result.self).toMatchObject({
      n: 1,
      beforeAvg: 4,
      afterAvg: 8,
      change: 4,
      up: 1,
    });
    // No cuts at all: the judge side is empty, not zero.
    expect(result.judge).toMatchObject({ n: 0, change: null });
    expect(result.medianDaysApart).toBe(50);
  });

  it('drops a learner whose first and latest share no item', () => {
    const answers = byLearner(
      [ans(1, 0, { verbal: 4 }), ans(1, 50, { harm: 8 })],
      (a) => a.answeredAt,
    );
    expect(confidenceChange(answers, new Map(), engage, 1).learners).toBe(0);
  });

  it('sets the judge’s level at the cuts nearest each answer beside it, same people and skills', () => {
    const answers = byLearner(
      [
        ans(1, 0, { verbal: 4, harm: 6 }),
        ans(1, 60, { verbal: 8, harm: 6 }),
        // Learner 2: both answers nearest the SAME cut — no practice between.
        ans(2, 0, { verbal: 3 }),
        ans(2, 3, { verbal: 9 }),
      ],
      (a) => a.answeredAt,
    );
    const cuts = byLearner(
      [
        cut(1, 2, { verbal: 2 }), // harm not assessable here
        cut(1, 58, { verbal: 3, harm: 2 }),
        cut(2, 1, { verbal: 2 }),
      ],
      (c) => c.closedAt,
    );
    const result = confidenceChange(answers, cuts, engage, 1);
    expect(result.learners).toBe(2);
    // The judge compares verbal only (harm was not assessable in the first cut).
    expect(result.judge).toMatchObject({
      n: 1,
      beforeAvg: 2,
      afterAvg: 3,
      change: 1,
    });
    expect(result.selfMatched).toMatchObject({
      n: 1,
      beforeAvg: 4,
      afterAvg: 8,
      change: 4,
    });
  });

  it('withholds averages below the floor while counts travel', () => {
    const answers = byLearner(
      [
        ans(1, 0, { verbal: 4 }),
        ans(1, 40, { verbal: 6 }),
        ans(2, 0, { verbal: 7 }),
        ans(2, 40, { verbal: 5 }),
      ],
      (a) => a.answeredAt,
    );
    const result = confidenceChange(answers, new Map(), ['verbal'], 3);
    expect(result.self).toMatchObject({
      n: 2,
      beforeAvg: null,
      afterAvg: null,
      change: null,
      changeCi: null,
      signP: null,
      detectable: false,
      up: 1,
      down: 1,
    });
    expect(result.medianDaysApart).toBeNull();
  });
});

describe('calibration (EFF-72)', () => {
  it('matches each rated item to the nearest cut assessing that skill', () => {
    const cuts = byLearner(
      [cut(1, 5, { verbal: 2 }), cut(1, 100, { harm: 1 })],
      (c) => c.closedAt,
    );
    const { observations, unmatched } = matchObservations(
      [ans(1, 0, { verbal: 10, harm: 10 })],
      cuts,
    );
    // harm's only cut is 100 days away.
    expect(unmatched).toBe(1);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      skill: 'verbal',
      selfRating: 10,
      rescaled: 4,
      level: 2,
      gap: 2,
    });
  });

  it('classifies one point per learner and floors the shares', () => {
    const points = [
      { self: 10, level: 2, gap: 2 }, // over
      { self: 5, level: 2, gap: 0.5 }, // calibrated
      { self: 0, level: 3, gap: -2 }, // under
    ];
    expect(calibrationStats(points, 3, 30)).toMatchObject({
      learners: 3,
      overConfident: 1,
      calibrated: 1,
      underConfident: 1,
      overConfidentPct: 33.3,
      calibratedPct: 33.3,
      underConfidentPct: 33.3,
      meanGap: 0.17,
      spearmanR: null, // below 30 points
    });
    expect(calibrationStats(points, 4, 30)).toMatchObject({
      learners: 3,
      overConfident: 1,
      overConfidentPct: null,
      meanGap: null,
      meanGapCi: null,
    });
  });

  it('never returns a share over an empty denominator', () => {
    expect(calibrationStats([], 1, 30)).toMatchObject({
      learners: 0,
      overConfidentPct: null,
      meanGap: null,
      spearmanR: null,
    });
  });

  it('pools a learner’s latest matched answer across its skills', () => {
    const cuts = byLearner(
      [cut(1, 0, { verbal: 2, harm: 4 })],
      (c) => c.closedAt,
    );
    const { observations } = matchObservations(
      [ans(1, -20, { verbal: 0 }), ans(1, 1, { verbal: 10, harm: 0 })],
      cuts,
    );
    expect(overallPerLearner(observations)).toEqual([
      // rescaled (4 + 1) / 2 = 2.5 against levels (2 + 4) / 2 = 3
      { self: 5, level: 3, gap: -0.5 },
    ]);
  });
});

describe('buildSelfEfficacy', () => {
  it('returns counts of 0 and nulls with no answers ("not yet measured")', () => {
    const built = buildSelfEfficacy(instrument, [], [], { floor: 20 });
    expect(built.coverage).toEqual({
      responses: 0,
      answeredResponses: 0,
      dismissedResponses: 0,
      byTrigger: { ONBOARDING: 0, CUTS: 0, COURSE: 0 },
      learnersAsked: 0,
      learnersAnswered: 0,
      learnersWithTwoOrMore: 0,
      itemsAnswered: 0,
      matchedObservations: 0,
      unmatchedObservations: 0,
    });
    expect(built.confidence.tiers.map((t) => t.tier)).toEqual([
      'engage',
      'understand',
      'support',
    ]);
    for (const row of [...built.confidence.tiers, ...built.confidence.skills]) {
      expect(row.learners).toBe(0);
      expect(row.self.change).toBeNull();
      expect(row.judge.change).toBeNull();
    }
    expect(built.calibration.skills).toHaveLength(14);
    for (const row of built.calibration.skills) {
      expect(row.learners).toBe(0);
      expect(row.overConfidentPct).toBeNull();
    }
    expect(built.calibration.points).toEqual([]);
  });

  it('counts dismissals as asked, not answered, and drops them from both cards', () => {
    const built = buildSelfEfficacy(
      instrument,
      [
        ans(1, 0, {}, 'ONBOARDING'),
        ans(2, 0, { verbal: 6 }, 'ONBOARDING'),
        ans(2, 30, { verbal: 7, notASkill: 3 } as any, 'COURSE'),
      ],
      [],
      { floor: 1 },
    );
    expect(built.coverage).toMatchObject({
      responses: 3,
      answeredResponses: 2,
      dismissedResponses: 1,
      byTrigger: { ONBOARDING: 2, CUTS: 0, COURSE: 1 },
      learnersAsked: 2,
      learnersAnswered: 1,
      learnersWithTwoOrMore: 1,
      itemsAnswered: 2, // the unknown key is ignored
      unmatchedObservations: 2,
    });
  });

  /** n learners, each over-confident on verbal by construction (self 9 vs level 2). */
  const overConfidentCohort = (n: number) => {
    const answers: SelfEfficacyAnswer[] = [];
    const cuts: SelfEfficacyCut[] = [];
    for (let u = 1; u <= n; u += 1) {
      answers.push(ans(u, 0, { verbal: 4, harm: 9 }, 'ONBOARDING'));
      answers.push(ans(u, 45, { verbal: 9, harm: 9 }));
      cuts.push(cut(u, 1, { verbal: 2 }));
      cuts.push(cut(u, 44, { verbal: 2, harm: 1 }));
    }
    return { answers, cuts };
  };

  it('withholds scatter points for a skill below the floor', () => {
    const { answers, cuts } = overConfidentCohort(4);
    const built = buildSelfEfficacy(instrument, answers, cuts, { floor: 5 });
    expect(built.calibration.pointsTotal).toBeGreaterThan(0);
    expect(built.calibration.points).toEqual([]);
    const verbal = built.calibration.skills.find((s) => s.skill === 'verbal');
    expect(verbal).toMatchObject({
      learners: 4,
      overConfident: 4,
      overConfidentPct: null,
    });
  });

  it('reads an over-confident cohort as over-confident, beside a flat judge', () => {
    const { answers, cuts } = overConfidentCohort(30);
    const built = buildSelfEfficacy(instrument, answers, cuts, { floor: 20 });

    const verbal = built.calibration.skills.find((s) => s.skill === 'verbal');
    expect(verbal).toMatchObject({
      learners: 30,
      observations: 60, // both answers matched
      overConfident: 30,
      overConfidentPct: 100,
      calibratedPct: 0,
      meanGap: 1.7, // 1 + 2.7 − 2
    });
    // Every point on one spot: no rank variation, so no correlation to report.
    expect(verbal?.spearmanR).toBeNull();

    const harm = built.calibration.skills.find((s) => s.skill === 'harm');
    expect(harm).toMatchObject({ learners: 30, overConfidentPct: 100 });

    const engage = built.confidence.tiers.find((t) => t.tier === 'engage');
    // verbal 4 → 9 and harm 9 → 9: tier mean 6.5 → 9.
    expect(engage?.self).toMatchObject({ n: 30, beforeAvg: 6.5, afterAvg: 9 });
    // Judge: the cuts nearest each answer, verbal only (harm absent at day 1).
    expect(engage?.judge).toMatchObject({ n: 30, change: 0 });
    expect(engage?.selfMatched).toMatchObject({ n: 30, change: 5 });

    // verbal: both answers matched (60); harm: only the latest (the first's
    // nearest harm cut is 44 days away), so 30 matched and 30 not.
    expect(built.calibration.points.length).toBe(90);
    expect(built.calibration.pointsTruncated).toBe(false);
    expect(built.coverage.unmatchedObservations).toBe(30);
  });

  it('caps the scatter at the point cap, most recent first', () => {
    const { answers, cuts } = overConfidentCohort(30);
    const built = buildSelfEfficacy(instrument, answers, cuts, {
      floor: 20,
      pointCap: 10,
    });
    expect(built.calibration.points).toHaveLength(10);
    expect(built.calibration.pointsTruncated).toBe(true);
    expect(built.calibration.pointsTotal).toBe(90);
  });

  it('reports a rank correlation once there are enough varied points', () => {
    const answers: SelfEfficacyAnswer[] = [];
    const cuts: SelfEfficacyCut[] = [];
    for (let u = 1; u <= 40; u += 1) {
      const level = 1 + (u % 4);
      answers.push(ans(u, 0, { empathy: Math.min(10, level * 2 + (u % 2)) }));
      cuts.push(cut(u, 2, { empathy: level }));
    }
    const built = buildSelfEfficacy(instrument, answers, cuts, { floor: 20 });
    const empathy = built.calibration.skills.find((s) => s.skill === 'empathy');
    expect(empathy?.learners).toBe(40);
    expect(empathy?.spearmanR).toBeGreaterThan(0.9);
  });
});
