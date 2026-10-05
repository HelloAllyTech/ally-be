import { FHS_RUBRIC } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  UptakeCut,
  UptakeSession,
  buildFeedbackUptake,
  buildObservations,
  collapsePerLearner,
  sessionSides,
} from '../feedback-uptake.util';

const day = (d: number, h = 12) => new Date(Date.UTC(2026, 8, d, h, 0, 0));

const cut = (
  userId: number,
  cutIndex: number,
  closedAt: Date,
  firstEndedAt: Date | null,
  levels: Record<string, number>,
): UptakeCut => ({ userId, cutIndex, closedAt, firstEndedAt, levels });

const session = (
  userId: number,
  endedAt: Date,
  namedSkills: string[],
  sessionId = `${userId}-${endedAt.toISOString()}`,
): UptakeSession => ({ sessionId, userId, endedAt, namedSkills });

describe('sessionSides — the pairing rule', () => {
  // Cut 1 closes on day 2; cut 2 spans days 3..5; cut 3 starts day 6.
  const cuts = [
    cut(1, 1, day(2), day(1), {}),
    cut(1, 2, day(5), day(3), {}),
    cut(1, 3, day(8), day(6), {}),
  ];

  it('before = last cut closed AT OR BEFORE the session ended (the cut closed in it counts)', () => {
    expect(sessionSides(day(2), cuts).before?.cutIndex).toBe(1);
    expect(sessionSides(day(2, 13), cuts).before?.cutIndex).toBe(1);
    expect(sessionSides(day(5), cuts).before?.cutIndex).toBe(2);
  });

  it('after = first cut whose FIRST session ended strictly after it', () => {
    expect(sessionSides(day(2), cuts).after?.cutIndex).toBe(2);
    // A cut carrying the tail of this very session (first session = it) is not after.
    expect(sessionSides(day(3), cuts).after?.cutIndex).toBe(3);
  });

  it('a cut straddling the session is on neither side', () => {
    // Session ends day 4, inside cut 2 (first session day 3, closed day 5).
    const sides = sessionSides(day(4), cuts);
    expect(sides.before?.cutIndex).toBe(1);
    expect(sides.after?.cutIndex).toBe(3);
  });

  it('no before when nothing closed yet; no after when nothing followed; a cut with no first session is never after', () => {
    expect(sessionSides(day(1), cuts).before).toBeNull();
    expect(sessionSides(day(8), cuts).after).toBeNull();
    expect(
      sessionSides(day(1), [cut(1, 1, day(3), null, {})]).after,
    ).toBeNull();
  });
});

describe('buildObservations', () => {
  const cutsByUser = new Map<number, UptakeCut[]>([
    [
      1,
      [
        cut(1, 1, day(2), day(1), { feelings: 1, verbal: 2, goals: 3 }),
        cut(1, 2, day(5), day(3), { feelings: 1, verbal: 2 }),
        cut(1, 3, day(8), day(6), { feelings: 3, verbal: 2, harm: 2 }),
      ],
    ],
  ]);

  it('splits skills assessable in both cuts into named and unnamed, with the direction of change', () => {
    // Day 4 is inside cut 2: before = cut 1, after = cut 3.
    const built = buildObservations(
      [session(1, day(4), ['feelings'])],
      cutsByUser,
    );
    expect(built.observations).toEqual(
      [
        {
          userId: 1,
          skill: 'verbal',
          role: 'unnamed',
          outcome: 'held',
          beforeLevel: 2,
        },
        {
          userId: 1,
          skill: 'feelings',
          role: 'named',
          outcome: 'rose',
          beforeLevel: 1,
        },
      ].sort(
        (a, b) =>
          FHS_RUBRIC.findIndex((s) => s.key === a.skill) -
          FHS_RUBRIC.findIndex((s) => s.key === b.skill),
      ),
    );
    expect(built).toMatchObject({
      sessionsPaired: 1,
      windows: 1,
      learnersPaired: 1,
      namedNotAssessable: 0,
    });
  });

  it('counts a named skill that was not assessable on both sides, and leaves it out', () => {
    const built = buildObservations(
      [session(1, day(4), ['goals', 'harm'])],
      cutsByUser,
    );
    expect(built.namedNotAssessable).toBe(2);
    expect(built.observations.every((o) => o.role === 'unnamed')).toBe(true);
  });

  it('merges sessions sharing both cuts into ONE window; a skill any of them named is named', () => {
    const built = buildObservations(
      [session(1, day(3, 15), ['feelings']), session(1, day(4), [])],
      cutsByUser,
    );
    expect(built.sessionsPaired).toBe(2);
    expect(built.windows).toBe(1);
    // The same two cuts are counted once, and feelings is never "unnamed" for the neighbour.
    expect(built.observations.filter((o) => o.skill === 'feelings')).toEqual([
      {
        userId: 1,
        skill: 'feelings',
        role: 'named',
        outcome: 'rose',
        beforeLevel: 1,
      },
    ]);
  });

  it('drops a session with no cut on one side', () => {
    const built = buildObservations(
      [
        session(1, day(1), ['feelings']),
        session(1, day(9), ['feelings']),
        session(2, day(4), ['feelings']),
      ],
      cutsByUser,
    );
    expect(built).toMatchObject({
      sessionsPaired: 0,
      windows: 0,
      learnersPaired: 0,
      observations: [],
    });
  });
});

describe('collapsePerLearner', () => {
  it('gives each learner ONE share per outcome and one mean before level', () => {
    const learners = collapsePerLearner([
      {
        userId: 1,
        skill: 'verbal',
        role: 'named',
        outcome: 'rose',
        beforeLevel: 1,
      },
      {
        userId: 1,
        skill: 'verbal',
        role: 'named',
        outcome: 'rose',
        beforeLevel: 2,
      },
      {
        userId: 1,
        skill: 'verbal',
        role: 'named',
        outcome: 'held',
        beforeLevel: 2,
      },
      {
        userId: 1,
        skill: 'verbal',
        role: 'named',
        outcome: 'fell',
        beforeLevel: 3,
      },
      {
        userId: 2,
        skill: 'verbal',
        role: 'named',
        outcome: 'fell',
        beforeLevel: 2,
      },
    ]);
    expect(learners.get(1)).toEqual({
      userId: 1,
      n: 4,
      rose: 0.5,
      held: 0.25,
      fell: 0.25,
      beforeLevel: 2,
    });
    expect(learners.get(2)).toMatchObject({ n: 1, rose: 0, fell: 1 });
  });
});

describe('buildFeedbackUptake — floors and the within-learner difference', () => {
  /**
   * `learners` learners, each with one window (cut 1 → cut 2 around a session
   * on day 4) that named `feelings`. Feelings rises for the first `riseNamed`
   * learners; verbal (unnamed) rises for the first `riseUnnamed`.
   */
  const cohort = (learners: number, riseNamed: number, riseUnnamed: number) => {
    const cutsByUser = new Map<number, UptakeCut[]>();
    const sessions: UptakeSession[] = [];
    for (let u = 1; u <= learners; u += 1) {
      cutsByUser.set(u, [
        cut(u, 1, day(2), day(1), { feelings: 1, verbal: 2 }),
        cut(u, 2, day(6), day(5), {
          feelings: u <= riseNamed ? 2 : 1,
          verbal: u <= riseUnnamed ? 3 : 2,
        }),
      ]);
      sessions.push(session(u, day(4), ['feelings']));
    }
    return { sessions, cutsByUser };
  };

  it('withholds every share and difference below the floor, while counts travel', () => {
    const { sessions, cutsByUser } = cohort(19, 19, 0);
    const built = buildFeedbackUptake(sessions, cutsByUser, 20);
    const feelings = built.skills.find((s) => s.skill === 'feelings')!;

    expect(feelings.named).toEqual({
      learners: 19,
      observations: 19,
      rosePct: null,
      heldPct: null,
      fellPct: null,
      beforeLevelAvg: null,
    });
    expect(built.pooled.difference).toMatchObject({
      learners: 19,
      change: null,
      changeCi: null,
      namedRosePct: null,
      unnamedRosePct: null,
      signP: null,
      detectable: false,
    });
  });

  it('at the floor: named vs unnamed shares, and named − unnamed within learner', () => {
    const { sessions, cutsByUser } = cohort(20, 15, 5);
    const built = buildFeedbackUptake(sessions, cutsByUser, 20);
    const feelings = built.skills.find((s) => s.skill === 'feelings')!;
    const verbal = built.skills.find((s) => s.skill === 'verbal')!;

    expect(feelings.named).toEqual({
      learners: 20,
      observations: 20,
      rosePct: 75,
      heldPct: 25,
      fellPct: 0,
      beforeLevelAvg: 1,
    });
    expect(feelings.unnamed.learners).toBe(0);
    expect(feelings.unnamed.rosePct).toBeNull();
    // A per-skill difference needs the same learners in both roles on that skill.
    expect(feelings.difference.learners).toBe(0);
    expect(verbal.unnamed).toMatchObject({
      learners: 20,
      rosePct: 25,
      beforeLevelAvg: 2,
    });

    // Pooled: each learner's named share (feelings) − their unnamed share (verbal).
    expect(built.pooled.named.rosePct).toBe(75);
    expect(built.pooled.unnamed.rosePct).toBe(25);
    expect(built.pooled.difference).toMatchObject({
      learners: 20,
      namedRosePct: 75,
      unnamedRosePct: 25,
      change: 50,
    });
    expect(built.pooled.difference.changeCi).not.toBeNull();
    const [lo, hi] = built.pooled.difference.changeCi!;
    expect(lo).toBeLessThanOrEqual(50);
    expect(hi).toBeGreaterThanOrEqual(50);
  });

  it('returns all 14 rubric skills in rubric order, zero counts where nothing was named', () => {
    const built = buildFeedbackUptake([], new Map(), 20);
    expect(built.skills.map((s) => s.skill)).toEqual(
      FHS_RUBRIC.map((s) => s.key),
    );
    expect(built.skills[0]).toMatchObject({
      name: FHS_RUBRIC[0].name,
      tier: FHS_RUBRIC[0].tier,
      named: { learners: 0, observations: 0, rosePct: null },
      difference: { learners: 0, change: null, detectable: false },
    });
  });

  it('is deterministic: the same data draws the same interval', () => {
    const { sessions, cutsByUser } = cohort(25, 15, 8);
    const a = buildFeedbackUptake(sessions, cutsByUser, 20);
    const b = buildFeedbackUptake(sessions, cutsByUser, 20);
    expect(a.pooled.difference.changeCi).toEqual(b.pooled.difference.changeCi);
  });
});
