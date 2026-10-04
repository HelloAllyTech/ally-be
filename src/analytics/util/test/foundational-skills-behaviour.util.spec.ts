import {
  FHS_BEHAVIOUR_THRESHOLDS,
  computeBehaviourRates,
  halves,
} from '../foundational-skills-behaviour.util';
import {
  ProgressCut,
  ProgressLearner,
} from '../foundational-skills-progress.util';

const cut = (
  k: number,
  levels: Record<string, number>,
  codes: string[] = [],
): ProgressCut => ({
  cut: k,
  score: 2,
  unhelpful: false,
  levels,
  observed: new Set(codes),
});
const learner = (userId: number, cuts: ProgressCut[]): ProgressLearner => ({
  userId,
  name: `L${userId}`,
  tenantId: 't',
  cuts,
});

describe('foundational-skills behaviour rates', () => {
  it('splits a learner into first and last halves only from minCuts slices', () => {
    expect(FHS_BEHAVIOUR_THRESHOLDS.minCuts).toBe(4);
    const three = learner(
      1,
      [1, 2, 3].map((k) => cut(k, { verbal: 3 })),
    );
    expect(halves(three)).toBeNull();
    const five = learner(
      2,
      [1, 2, 3, 4, 5].map((k) => cut(k, { verbal: 3 })),
    );
    expect(halves(five)!.start.map((c) => c.cut)).toEqual([1, 2]);
    expect(halves(five)!.now.map((c) => c.cut)).toEqual([4, 5]);
  });

  it('counts a behaviour only where its skill could be shown', () => {
    const l = learner(1, [
      cut(1, { verbal: 3 }, ['verbal.b1']),
      cut(2, { empathy: 2 }), // verbal not assessable: no chance, not a miss
      cut(3, { verbal: 2 }),
      cut(4, { verbal: 3 }, ['verbal.b1']),
    ]);
    const r = computeBehaviourRates([l], { sampleFloor: 1, userId: 1 });
    const b1 = r.learners[0].behaviours.find((b) => b.code === 'verbal.b1')!;
    expect(b1.all).toEqual({ hits: 2, chances: 3 });
    expect(b1.start).toEqual({ hits: 1, chances: 1 });
    expect(b1.now).toEqual({ hits: 1, chances: 2 });
  });

  it('calls one learner clear only when Fisher clears the bar', () => {
    const adopter = learner(1, [
      ...[1, 2, 3, 4].map((k) => cut(k, { verbal: 2 })),
      ...[5, 6, 7, 8].map((k) => cut(k, { verbal: 3 }, ['verbal.b1'])),
    ]);
    const wobble = learner(2, [
      cut(1, { verbal: 2 }),
      cut(2, { verbal: 2 }, ['verbal.b1']),
      cut(3, { verbal: 2 }, ['verbal.b1']),
      cut(4, { verbal: 2 }, ['verbal.b1']),
    ]);
    const r = computeBehaviourRates([adopter, wobble], { sampleFloor: 1 });
    const get = (id: number) =>
      computeBehaviourRates([adopter, wobble], {
        sampleFloor: 1,
        userId: id,
      }).learners[0].behaviours.find((b) => b.code === 'verbal.b1')!;
    expect(get(1)).toMatchObject({ clear: 'adopted' }); // 0/4 -> 4/4, p≈0.029
    expect(get(1).p).toBeCloseTo(0.0286, 3);
    expect(get(2).clear).toBeNull(); // 1/2 -> 2/2 is not clear
    expect(
      r.behaviours.find((b) => b.code === 'verbal.b1')!.change.learnersAdopted,
    ).toBe(1);
  });

  it('pairs the group change, corrects across behaviours and withholds below the floor', () => {
    const learners = Array.from({ length: 6 }, (_, i) =>
      learner(i + 1, [
        cut(1, { verbal: 2 }),
        cut(2, { verbal: 2 }),
        cut(3, { verbal: 3 }, ['verbal.b1']),
        cut(4, { verbal: 3 }, ['verbal.b1']),
      ]),
    );
    const shown = computeBehaviourRates(learners, { sampleFloor: 5 });
    const b1 = shown.behaviours.find((b) => b.code === 'verbal.b1')!;
    expect(b1.change).toMatchObject({
      n: 6,
      startPct: 0,
      nowPct: 100,
      changePts: 100,
      up: 6,
      down: 0,
    });
    expect(b1.change.signP).toBeCloseTo(0.031, 3);
    expect(b1.change.q).not.toBeNull();
    const withheld = computeBehaviourRates(learners, { sampleFloor: 10 });
    expect(
      withheld.behaviours.find((b) => b.code === 'verbal.b1')!.change,
    ).toMatchObject({
      n: 6,
      changePts: null,
      ciPts: null,
      credible: false,
    });
  });

  it('reports ICC only with enough repeat-chance learners, and grids helpful trackable habits', () => {
    // Half the learners always introduce themselves, half never: a strong habit.
    const learners = Array.from({ length: 20 }, (_, i) =>
      learner(
        i + 1,
        [1, 2, 3].map((k) =>
          cut(
            k,
            { rapport: 2, verbal: 3 },
            i % 2 ? ['rapport.b1', 'verbal.u1'] : [],
          ),
        ),
      ),
    );
    const r = computeBehaviourRates(learners, { sampleFloor: 20 });
    const intro = r.behaviours.find((b) => b.code === 'rapport.b1')!;
    expect(intro.icc).toBeGreaterThan(0.9);
    expect(intro.trackable).toBe(true);
    expect(r.gridCodes).toContain('rapport.b1');
    expect(r.gridCodes).not.toContain('verbal.u1'); // unhelpful: flags, not the grid
    const few = computeBehaviourRates(learners.slice(0, 10), {
      sampleFloor: 20,
    });
    expect(few.behaviours.find((b) => b.code === 'rapport.b1')!.icc).toBeNull();
    // The list carries grid habits only; one learner carries everything they had a chance at.
    expect(
      r.learners[0].behaviours.every((b) => r.gridCodes.includes(b.code)),
    ).toBe(true);
    const one = computeBehaviourRates(learners, { sampleFloor: 20, userId: 2 });
    expect(one.learners).toHaveLength(1);
    expect(one.learners[0].behaviours.map((b) => b.code)).toContain(
      'verbal.u1',
    );
  });
});
