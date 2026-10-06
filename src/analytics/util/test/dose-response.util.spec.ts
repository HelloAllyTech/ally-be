import {
  ProgressLearner,
  cutNoiseSd,
  learnerTrend,
} from '../foundational-skills-progress.util';
import {
  DOSE_RESPONSE_MIN_LEARNERS,
  DoseResponseLearner,
  bootstrapSlopeCi,
  buildDoseResponse,
  classifyDoseResponse,
  leastSquares,
} from '../dose-response.util';

/** A learner whose cuts 1..k carry `scores`. */
const learner = (userId: number, scores: number[]): ProgressLearner => ({
  userId,
  name: `Learner ${userId}`,
  tenantId: 't-1',
  cuts: scores.map((score, i) => ({
    cut: i + 1,
    score,
    unhelpful: false,
    levels: {},
    observed: new Set<string>(),
  })),
});

/** `n` classified learners, cuts 4..(4 + n % 7), change = 0.05·cuts − 0.1. */
const linear = (n: number): DoseResponseLearner[] =>
  Array.from({ length: n }, (_, i) => {
    const cuts = 4 + (i % 7);
    return {
      learnerId: i + 1,
      cuts,
      change: 0.05 * cuts - 0.1,
      trend: 'steady' as const,
    };
  });

describe('dose-response util', () => {
  it('serves the population gate as a constant', () => {
    expect(DOSE_RESPONSE_MIN_LEARNERS).toBe(40);
  });

  describe('leastSquares', () => {
    it('recovers an exact line', () => {
      expect(leastSquares([1, 2, 3, 4], [3, 5, 7, 9])).toEqual({
        slope: 2,
        intercept: 1,
      });
    });

    it('has no slope when x has no spread, or below two points', () => {
      expect(leastSquares([3, 3, 3], [1, 2, 3])).toBeNull();
      expect(leastSquares([1], [1])).toBeNull();
      expect(leastSquares([1, 2], [1])).toBeNull();
    });
  });

  describe('bootstrapSlopeCi', () => {
    const xs = Array.from({ length: 30 }, (_, i) => 4 + (i % 9));
    // A real slope of 0.1 with a deterministic wobble.
    const ys = xs.map((x, i) => 0.1 * x + ((i * 37) % 11) / 20 - 0.25);

    it('is deterministic: the same data draws the same interval', () => {
      expect(bootstrapSlopeCi(xs, ys)).toEqual(bootstrapSlopeCi(xs, ys));
    });

    it('brackets the fitted slope', () => {
      const ci = bootstrapSlopeCi(xs, ys) as [number, number];
      const fit = leastSquares(xs, ys)!;
      expect(ci[0]).toBeLessThan(fit.slope);
      expect(ci[1]).toBeGreaterThan(fit.slope);
      expect(ci[0]).toBeGreaterThan(0); // the slope is real
    });

    it('changes with the seed, but only within noise', () => {
      const a = bootstrapSlopeCi(xs, ys, 4000, 1) as [number, number];
      const b = bootstrapSlopeCi(xs, ys, 4000, 2) as [number, number];
      expect(a).not.toEqual(b);
      expect(Math.abs(a[0] - b[0])).toBeLessThan(0.02);
    });

    it('is null below three people or when nobody differs on x', () => {
      expect(bootstrapSlopeCi([1, 2], [1, 2])).toBeNull();
      expect(bootstrapSlopeCi([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
    });

    it('resamples people, so a duplicated row is not a free narrower interval', () => {
      // 10 distinct learners vs the same 10 each counted twice: the interval
      // over 20 rows is narrower — which is exactly why callers pass ONE row
      // per learner.
      const x10 = xs.slice(0, 10);
      const y10 = ys.slice(0, 10);
      const once = bootstrapSlopeCi(x10, y10) as [number, number];
      const twice = bootstrapSlopeCi([...x10, ...x10], [...y10, ...y10]) as [
        number,
        number,
      ];
      expect(twice[1] - twice[0]).toBeLessThan(once[1] - once[0]);
    });
  });

  describe('classifyDoseResponse', () => {
    const learners = [
      learner(1, [2, 2.2, 2.6, 2.8]), // 4 cuts → classified
      learner(2, [2.5, 2.3, 2.4, 2.2, 2.1, 2.0]), // 6 cuts → classified
      learner(3, [2, 3, 2]), // 3 cuts → too early
      learner(4, [3]), // 1 cut → too early
    ];

    it('keeps exactly the learners learnerTrend classifies, with its change', () => {
      const noise = cutNoiseSd(learners);
      const out = classifyDoseResponse(learners);
      expect(out.map((l) => l.learnerId)).toEqual([1, 2]);
      for (const l of out) {
        const src = learners.find((x) => x.userId === l.learnerId)!;
        const t = learnerTrend(src, noise);
        expect(l.change).toBe(t.change);
        expect(l.trend).toBe(t.trend);
        expect(l.cuts).toBe(src.cuts.length);
      }
    });

    it('classifies nobody when there is no noise estimate', () => {
      expect(classifyDoseResponse([learner(1, [2])])).toEqual([]);
    });
  });

  describe('buildDoseResponse', () => {
    it('withholds the scatter and both fits below the gate, keeping the count', () => {
      const out = buildDoseResponse(linear(39), null);
      expect(out).toEqual({
        minLearners: 40,
        classifiedLearners: 39,
        measurable: false,
        learnersWithMinutes: null,
        learnersScatter: null,
        fit: null,
        minutesFit: null,
      });
    });

    it('fits change on cuts from the gate up, with a slope CI', () => {
      const out = buildDoseResponse(linear(40), null);
      expect(out.measurable).toBe(true);
      expect(out.learnersScatter).toHaveLength(40);
      expect(out.fit).toMatchObject({
        x: 'cuts',
        n: 40,
        slope: 0.05,
        intercept: -0.1,
        slopeCi: [0.05, 0.05],
        detectable: true,
        xMin: 4,
        xMax: 10,
      });
      // No minutes read → no minutes fit, and the count is unknown, not 0.
      expect(out.minutesFit).toBeNull();
      expect(out.learnersWithMinutes).toBeNull();
      expect(out.learnersScatter![0].practiceMinutes).toBeNull();
    });

    it('calls a flat cloud "not detectable" rather than a slope', () => {
      const flat = linear(40).map((l, i) => ({
        ...l,
        change: i % 2 ? 0.2 : -0.2,
      }));
      const out = buildDoseResponse(flat, null);
      expect(out.fit!.detectable).toBe(false);
      expect(out.fit!.slopeCi![0]).toBeLessThan(0);
      expect(out.fit!.slopeCi![1]).toBeGreaterThan(0);
    });

    it('has no fit when every learner has the same number of cuts', () => {
      const same = linear(40).map((l) => ({ ...l, cuts: 6 }));
      const out = buildDoseResponse(same, null);
      expect(out.measurable).toBe(true);
      expect(out.learnersScatter).toHaveLength(40);
      expect(out.fit).toBeNull();
    });

    it('fits on practice hours over the learners with minutes, behind the same gate', () => {
      const classified = linear(45);
      // 30 minutes per cut for everyone but learner 45 (no measurable duration).
      const minutes = new Map(
        classified.slice(0, 44).map((l) => [l.learnerId, 30 * l.cuts]),
      );
      const out = buildDoseResponse(classified, minutes);
      expect(out.learnersWithMinutes).toBe(44);
      expect(out.minutesFit).toMatchObject({ x: 'practiceHours', n: 44 });
      // change = 0.05·cuts − 0.1 and hours = cuts / 2 → 0.1 per hour.
      expect(out.minutesFit!.slope).toBe(0.1);
      const missing = out.learnersScatter!.find((p) => p.learnerId === 45)!;
      expect(missing.practiceMinutes).toBeNull();

      const few = new Map(
        classified.slice(0, 39).map((l) => [l.learnerId, 30 * l.cuts]),
      );
      const thin = buildDoseResponse(classified, few);
      expect(thin.learnersWithMinutes).toBe(39);
      expect(thin.minutesFit).toBeNull();
      expect(thin.fit).not.toBeNull();
    });

    it('sorts points by own change, never by level, and carries ids only', () => {
      const out = buildDoseResponse(linear(40), new Map([[1, 12.345]]));
      const changes = out.learnersScatter!.map((p) => p.change);
      expect(changes).toEqual([...changes].sort((a, b) => b - a));
      const p1 = out.learnersScatter!.find((p) => p.learnerId === 1)!;
      expect(p1).toEqual({
        learnerId: 1,
        cuts: 4,
        practiceMinutes: 12.3,
        change: 0.1,
        trend: 'steady',
      });
      expect(Object.keys(p1)).not.toContain('name');
    });
  });
});
