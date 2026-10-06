import {
  averageRanks,
  buildKnowledgeVsSkill,
  buildProgressCurve,
  clusterBootstrapSpearmanCi,
  ClusteredPoint,
  duringAndAfterSlices,
  flooredSpearman,
  furthestPosition,
  isStartedEnrollment,
  KnowledgeEnrollmentRow,
  KnowledgeFirstAttemptRow,
  KnowledgeSkillCutRow,
  MIN_POINTS_FOR_CORRELATION,
  orderTrackItems,
  pearson,
  positionPct,
  ProgressCurveEnrollmentRow,
  ProgressCurveItemRow,
  spearman,
  steepestDrop,
} from '../course-progress-analytics.util';

const day = (n: number) => new Date(Date.UTC(2026, 6, 1 + n));

// ─────────────────────────────────────────────────────────────────────────────
// Progress curve fixtures
// ─────────────────────────────────────────────────────────────────────────────

const item = (
  trackId: string,
  itemId: string,
  sectionOrder: number,
  itemOrder: number,
  extra: Partial<ProgressCurveItemRow> = {},
): ProgressCurveItemRow => ({
  trackId,
  itemId,
  title: `Item ${itemId}`,
  type: 'ARTICLE',
  sectionId: `${trackId}-s${sectionOrder}`,
  sectionOrder,
  itemOrder,
  ...extra,
});

/** A 4-item course: two sections of two, deliberately listed out of order. */
const courseItems = (trackId = 'A'): ProgressCurveItemRow[] => [
  item(trackId, `${trackId}4`, 2, 2),
  item(trackId, `${trackId}1`, 1, 1),
  item(trackId, `${trackId}3`, 2, 1, { type: 'QUIZ' }),
  item(trackId, `${trackId}2`, 1, 2, { type: 'ROLEPLAY' }),
];

let seq = 0;
/**
 * An enrolment that reached the first `reached` items of a 4-item course
 * (UNLOCKED/COMPLETED rows) and opened the first `opened`. `reached = 4` with
 * `finished` marks it complete.
 */
const enrol = (
  trackId: string,
  reached: number,
  opts: { opened?: number; finished?: boolean; title?: string } = {},
): ProgressCurveEnrollmentRow => {
  const ids = [1, 2, 3, 4].map((k) => `${trackId}${k}`);
  const opened = opts.opened ?? Math.max(0, reached - 1);
  seq += 1;
  return {
    enrollmentId: `e${seq}`,
    trackId,
    title: opts.title ?? `Course ${trackId}`,
    status: 'ACTIVE',
    completedAt: opts.finished ? day(5) : null,
    completedItems: opts.finished ? 4 : Math.max(0, reached - 1),
    openedAny: opened > 0,
    reachedItemIds: ids.slice(0, reached),
    openedItemIds: ids.slice(0, opened),
  };
};

const repeat = <T>(n: number, make: () => T): T[] =>
  Array.from({ length: n }, make);

describe('orderTrackItems', () => {
  it('walks sections by order, then items by order within each section', () => {
    const ordered = orderTrackItems(courseItems()).get('A')!;
    expect(ordered.map((i) => i.itemId)).toEqual(['A1', 'A2', 'A3', 'A4']);
  });

  it('breaks order ties by id so the walk never depends on row order', () => {
    const rows = [
      item('A', 'b', 1, 1, { sectionId: 's' }),
      item('A', 'a', 1, 1, { sectionId: 's' }),
    ];
    expect(
      orderTrackItems(rows)
        .get('A')!
        .map((i) => i.itemId),
    ).toEqual(['a', 'b']);
    expect(
      orderTrackItems([...rows].reverse())
        .get('A')!
        .map((i) => i.itemId),
    ).toEqual(['a', 'b']);
  });
});

describe('isStartedEnrollment', () => {
  it('needs an opened or completed item, not just an enrolment', () => {
    expect(isStartedEnrollment(enrol('A', 1, { opened: 0 }))).toBe(false);
    expect(isStartedEnrollment(enrol('A', 1, { opened: 1 }))).toBe(true);
    expect(
      isStartedEnrollment({
        ...enrol('A', 2, { opened: 0 }),
        completedItems: 1,
      }),
    ).toBe(true);
    expect(
      isStartedEnrollment({
        ...enrol('A', 1, { opened: 0 }),
        completedItems: 0,
        completedAt: day(1),
      }),
    ).toBe(true);
  });
});

describe('furthestPosition', () => {
  const positions = new Map([
    ['A1', 1],
    ['A2', 2],
    ['A3', 3],
    ['A4', 4],
  ]);

  it('is the furthest reached item, ignoring ids no longer in the course', () => {
    const row = {
      ...enrol('A', 0),
      reachedItemIds: ['A1', 'A3', 'deleted-item'],
    };
    expect(furthestPosition(row, positions, 4)).toBe(3);
  });

  it('is every item for a finished enrolment, even items added after it finished', () => {
    const row = { ...enrol('A', 3, { finished: true }) };
    expect(furthestPosition(row, positions, 4)).toBe(4);
  });

  it('is 0 when nothing current was reached', () => {
    expect(
      furthestPosition({ ...enrol('A', 0), reachedItemIds: [] }, positions, 4),
    ).toBe(0);
  });
});

describe('positionPct', () => {
  it('puts the first item at 0 and the last at 100', () => {
    expect([1, 2, 3, 4].map((p) => positionPct(p, 4))).toEqual([
      0, 33.3, 66.7, 100,
    ]);
  });

  it('puts a one-item course at 0', () => {
    expect(positionPct(1, 1)).toBe(0);
  });
});

describe('steepestDrop', () => {
  const ordered = orderTrackItems(courseItems()).get('A')!;

  it('names the item learners stopped at and the fall in points', () => {
    const drop = steepestDrop(ordered, [20, 18, 8, 7], 6, 20)!;
    expect(drop).toMatchObject({
      fromPosition: 2,
      fromItemId: 'A2',
      fromItemType: 'ROLEPLAY',
      toPosition: 3,
      toItemId: 'A3',
      toFinish: false,
      lost: 10,
      dropPts: 50,
    });
  });

  it('can be the last item → finishing', () => {
    const drop = steepestDrop(ordered, [20, 20, 19, 19], 4, 20)!;
    expect(drop).toMatchObject({
      fromPosition: 4,
      toPosition: null,
      toItemId: null,
      toItemTitle: null,
      toFinish: true,
      lost: 15,
      dropPts: 75,
    });
  });

  it('gives ties to the earliest step', () => {
    const drop = steepestDrop(ordered, [20, 15, 10, 10], 10, 20)!;
    expect(drop.fromPosition).toBe(1);
  });

  it('is null when no step loses anyone, or with nobody started', () => {
    expect(steepestDrop(ordered, [20, 20, 20, 20], 20, 20)).toBeNull();
    expect(steepestDrop(ordered, [0, 0, 0, 0], 0, 0)).toBeNull();
  });
});

describe('buildProgressCurve', () => {
  const opts = { floor: 20, chartCourses: 5 };

  it('draws the share of STARTED enrolments that reached each item', () => {
    const enrolments = [
      ...repeat(10, () => enrol('A', 4, { finished: true, opened: 4 })),
      ...repeat(6, () => enrol('A', 2)),
      ...repeat(4, () => enrol('A', 1, { opened: 1 })),
      // Enrolled, never opened anything: not in the denominator.
      ...repeat(7, () => enrol('A', 1, { opened: 0 })),
    ];
    const built = buildProgressCurve(courseItems(), enrolments, opts);

    expect(built.courses).toHaveLength(1);
    const [course] = built.courses;
    expect(course).toMatchObject({
      trackId: 'A',
      items: 4,
      enrolments: 27,
      startedEnrolments: 20,
      completed: 10,
      completedPct: 50,
      inChart: true,
    });
    expect(course.points.map((p) => p.position)).toEqual([1, 2, 3, 4]);
    expect(course.points.map((p) => p.positionPct)).toEqual([
      0, 33.3, 66.7, 100,
    ]);
    expect(course.points.map((p) => p.reached)).toEqual([20, 16, 10, 10]);
    expect(course.points.map((p) => p.reachedPct)).toEqual([100, 80, 50, 50]);
    // Finished learners opened all 4; the 6 at item 2 opened item 1.
    expect(course.points.map((p) => p.opened)).toEqual([20, 10, 10, 10]);
    expect(course.points[2]).toMatchObject({
      itemId: 'A3',
      itemType: 'QUIZ',
      itemTitle: 'Item A3',
    });
    expect(course.steepestDrop).toMatchObject({
      fromPosition: 2,
      toPosition: 3,
      lost: 6,
      dropPts: 30,
    });
  });

  it('can only fall: an item inserted behind a learner does not make the line dip', () => {
    // Every learner's rows say A1, A3 reached but A2 locked (A2 was inserted later).
    const rows = repeat(20, () => ({
      ...enrol('A', 0, { opened: 1 }),
      reachedItemIds: ['A1', 'A3'],
    }));
    const [course] = buildProgressCurve(courseItems(), rows, opts).courses;
    expect(course.points.map((p) => p.reached)).toEqual([20, 20, 20, 0]);
  });

  it('withholds courses below the floor but still lists their counts', () => {
    const built = buildProgressCurve(
      courseItems('A'),
      repeat(19, () => enrol('A', 2)),
      opts,
    );
    expect(built.courses).toEqual([]);
    expect(built.others).toEqual([]);
    expect(built.belowFloor).toEqual([
      expect.objectContaining({
        trackId: 'A',
        startedEnrolments: 19,
        completedPct: null,
        steepestDrop: null,
        inChart: false,
      }),
    ]);
    expect(built.belowFloor[0]).not.toHaveProperty('points');
    expect(built.totals).toEqual({
      courses: 1,
      measurable: 0,
      enrolments: 19,
      startedEnrolments: 19,
    });
  });

  it('lists a course with no live items left as below the floor', () => {
    const built = buildProgressCurve(
      [],
      repeat(25, () => enrol('Z', 2)),
      opts,
    );
    expect(built.belowFloor[0]).toMatchObject({ trackId: 'Z', items: 0 });
    expect(built.courses).toEqual([]);
  });

  it('draws the 5 courses with the most started enrolments; the rest are listed without points', () => {
    const tracks = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const items = tracks.flatMap((t) => courseItems(t));
    const enrolments = tracks.flatMap((t, i) =>
      repeat(20 + i, () => enrol(t, 2)),
    );
    const built = buildProgressCurve(items, enrolments, opts);

    expect(built.courses.map((c) => c.trackId)).toEqual([
      'G',
      'F',
      'E',
      'D',
      'C',
    ]);
    expect(built.courses.every((c) => c.inChart && c.points.length === 4)).toBe(
      true,
    );
    expect(built.others.map((c) => c.trackId)).toEqual(['B', 'A']);
    for (const other of built.others) {
      expect(other.inChart).toBe(false);
      expect(other).not.toHaveProperty('points');
      expect(other.steepestDrop).not.toBeNull();
    }
    expect(built.totals.measurable).toBe(7);
  });

  it('returns empty lists, never an error, with no enrolments', () => {
    expect(buildProgressCurve(courseItems(), [], opts)).toEqual({
      courses: [],
      others: [],
      belowFloor: [],
      totals: {
        courses: 0,
        measurable: 0,
        enrolments: 0,
        startedEnrolments: 0,
      },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rank correlation
// ─────────────────────────────────────────────────────────────────────────────

describe('averageRanks', () => {
  it('gives tied values the mean of the ranks they span', () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(averageRanks([5, 5, 5])).toEqual([2, 2, 2]);
    expect(averageRanks([3, 1, 2])).toEqual([3, 1, 2]);
  });
});

describe('spearman', () => {
  it('is 1 for any strictly increasing relation, -1 for decreasing', () => {
    expect(spearman([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4], [9, 7, 3, 1])).toBeCloseTo(-1, 10);
  });

  it('handles ties exactly (Pearson on average ranks)', () => {
    // ranks x = [1, 2.5, 2.5, 4], ranks y = [1, 3, 2, 4] → 4.5 / √(4.5·5) = 3/√10
    expect(spearman([1, 2, 2, 3], [1, 3, 2, 4])).toBeCloseTo(
      3 / Math.sqrt(10),
      10,
    );
  });

  it('is null when a side does not vary or below 3 pairs', () => {
    expect(spearman([50, 50, 50, 50], [1, 2, 3, 4])).toBeNull();
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(pearson([1, 2, 3], [1, 2])).toBeNull();
  });
});

/** `n` learners, one point each, with y rising in x plus a fixed wobble. */
const correlated = (n: number, firstLearner = 1): ClusteredPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    x: i,
    y: i + (i % 3 === 0 ? 6 : 0),
    cluster: firstLearner + i,
  }));

describe('clusterBootstrapSpearmanCi', () => {
  it('is deterministic and brackets the point estimate', () => {
    const points = correlated(40);
    const a = clusterBootstrapSpearmanCi(points, 500);
    const b = clusterBootstrapSpearmanCi(points, 500);
    expect(a).toEqual(b);
    const r = spearman(
      points.map((p) => p.x),
      points.map((p) => p.y),
    )!;
    expect(a![0]).toBeLessThanOrEqual(r);
    expect(a![1]).toBeGreaterThanOrEqual(r);
  });

  it('resamples learners, so a learner repeated across courses does not narrow the interval', () => {
    const base = correlated(30).map((p) => ({ ...p, y: p.y + (p.x % 5) * 4 }));
    // The same 30 learners, each counted three times (three courses).
    const tripled = [...base, ...base, ...base];
    const byLearner = clusterBootstrapSpearmanCi(tripled, 800)!;
    // Pretending the 90 rows were 90 different people.
    const byRow = clusterBootstrapSpearmanCi(
      tripled.map((p, i) => ({ ...p, cluster: i })),
      800,
    )!;
    expect(byLearner[1] - byLearner[0]).toBeGreaterThan(byRow[1] - byRow[0]);
  });

  it('is null with fewer than 2 learners', () => {
    const one = correlated(10).map((p) => ({ ...p, cluster: 1 }));
    expect(clusterBootstrapSpearmanCi(one, 100)).toBeNull();
  });
});

describe('flooredSpearman', () => {
  it('withholds r below the floor but keeps the counts', () => {
    const below = flooredSpearman(
      correlated(29),
      MIN_POINTS_FOR_CORRELATION,
      200,
    );
    expect(below).toEqual({
      points: 29,
      learners: 29,
      r: null,
      rCi: null,
      detectable: false,
    });
  });

  it('reports r and a 2-dp interval at the floor', () => {
    const at = flooredSpearman(correlated(30), MIN_POINTS_FOR_CORRELATION, 400);
    expect(at.points).toBe(30);
    expect(at.r).not.toBeNull();
    expect(at.r).toBe(Math.round(at.r! * 100) / 100);
    expect(at.rCi).not.toBeNull();
    expect(at.detectable).toBe(at.rCi![0] > 0 || at.rCi![1] < 0);
    expect(at.detectable).toBe(true);
  });

  it('is null (not 0) when a side does not vary, even above the floor', () => {
    const flat = correlated(40).map((p) => ({ ...p, x: 70 }));
    expect(flooredSpearman(flat, 30, 100)).toMatchObject({
      r: null,
      rCi: null,
      detectable: false,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge vs skill
// ─────────────────────────────────────────────────────────────────────────────

const cut = (
  userId: number,
  firstEndedDay: number | null,
  composite: number,
  closedDay = firstEndedDay ?? 0,
): KnowledgeSkillCutRow => ({
  userId,
  closedAt: day(closedDay),
  firstEndedAt: firstEndedDay === null ? null : day(firstEndedDay),
  composite,
});

describe('duringAndAfterSlices', () => {
  it('keeps only slices whose first session ended after enrolling, up to the window', () => {
    const cuts = [
      cut(1, 1, 2.0), // before
      cut(1, 9, 2.1, 11), // straddles: first session before enrolling (day 10)
      cut(1, null, 2.2, 12), // first session gone
      cut(1, 12, 2.5),
      cut(1, 13, 2.6),
      cut(1, 14, 2.7),
    ];
    expect(
      duringAndAfterSlices(day(10), cuts, 2).map((c) => c.composite),
    ).toEqual([2.5, 2.6]);
    expect(duringAndAfterSlices(day(10), cuts, 6)).toHaveLength(3);
  });

  it('is empty without an enrolment time', () => {
    expect(duringAndAfterSlices(null, [cut(1, 12, 2.5)], 6)).toEqual([]);
  });
});

const kEnrol = (
  userId: number,
  trackId = 'A',
  startedDay: number | null = 10,
): KnowledgeEnrollmentRow => ({
  trackId,
  title: `Course ${trackId}`,
  status: 'ACTIVE',
  quizItems: 2,
  userId,
  startedAt: startedDay === null ? null : day(startedDay),
});

const attempt = (
  userId: number,
  trackItemId: string,
  scorePct: number | null,
  trackId = 'A',
  passed: boolean | null = scorePct === null ? null : scorePct >= 70,
): KnowledgeFirstAttemptRow => ({
  trackId,
  trackItemId,
  userId,
  scorePct,
  passed,
});

describe('buildKnowledgeVsSkill', () => {
  const opts = { window: 6, floor: MIN_POINTS_FOR_CORRELATION, resamples: 200 };

  it('plots one point per learner × course and accounts for everyone else', () => {
    const enrollments = [kEnrol(1), kEnrol(2), kEnrol(3), kEnrol(4, 'A', null)];
    const attempts = [
      attempt(1, 'q1', 80),
      attempt(1, 'q2', 60),
      // Learner 2's only first attempt is still pending grading.
      attempt(2, 'q1', 40, 'A', null),
      attempt(3, 'q1', 90),
      attempt(4, 'q1', 50),
    ];
    const cuts = [
      cut(1, 5, 1.0), // before enrolling: ignored
      cut(1, 12, 2.0),
      cut(1, 13, 3.0),
      cut(3, 2, 3.0), // learner 3 has only a slice from before
      cut(4, 12, 2.0), // learner 4 has no enrolment time
    ];
    const built = buildKnowledgeVsSkill(enrollments, attempts, cuts, opts);

    expect(built.points).toEqual([
      {
        trackId: 'A',
        learnerId: 1,
        quizScore: 70,
        skillScore: 2.5,
        quizzes: 2,
        slices: 2,
      },
    ]);
    expect(built.coverage).toEqual({
      courses: 1,
      enrolments: 4,
      points: 1,
      learners: 1,
      missingQuiz: 1, // learner 2
      missingSkill: 2, // learners 3 and 4
    });
    const [course] = built.courses;
    expect(course.enrolments).toBe(
      course.correlation.points + course.missingQuiz + course.missingSkill,
    );
    expect(course.correlation.r).toBeNull();
    expect(built.overall.r).toBeNull();
  });

  it('never lets a later row stand in for an unscored first attempt', () => {
    const built = buildKnowledgeVsSkill(
      [kEnrol(1)],
      [attempt(1, 'q1', null, 'A', null), attempt(1, 'q1', 95)],
      [cut(1, 12, 2)],
      opts,
    );
    expect(built.points).toEqual([]);
    expect(built.coverage.missingQuiz).toBe(1);
  });

  it('caps the skill score at the window of slices made after enrolling', () => {
    const cuts = [1, 2, 3, 4, 5, 6, 7, 8].map((k) =>
      cut(1, 10 + k, k <= 6 ? 2 : 4),
    );
    const built = buildKnowledgeVsSkill(
      [kEnrol(1)],
      [attempt(1, 'q1', 80)],
      cuts,
      opts,
    );
    expect(built.points[0]).toMatchObject({ skillScore: 2, slices: 6 });
  });

  it('shows r at 30 points, per course only where the course alone reaches it', () => {
    const learners = Array.from({ length: 30 }, (_, i) => i + 1);
    const enrollments = [
      ...learners.map((u) => kEnrol(u, 'A')),
      // 10 of the same learners also took course B.
      ...learners.slice(0, 10).map((u) => kEnrol(u, 'B')),
    ];
    const attempts = [
      ...learners.map((u) => attempt(u, 'qa', 40 + u * 2, 'A')),
      ...learners.slice(0, 10).map((u) => attempt(u, 'qb', 50 + u, 'B')),
    ];
    const cuts = learners.map((u) => cut(u, 20, 1.5 + u / 20));
    const built = buildKnowledgeVsSkill(enrollments, attempts, cuts, opts);

    expect(built.coverage).toMatchObject({ points: 40, learners: 30 });
    expect(built.overall.points).toBe(40);
    expect(built.overall.learners).toBe(30);
    expect(built.overall.r).not.toBeNull();

    const byTrack = new Map(built.courses.map((c) => [c.trackId, c]));
    expect(byTrack.get('A')!.correlation.r).toBe(1);
    expect(byTrack.get('B')!.correlation).toMatchObject({
      points: 10,
      r: null,
      rCi: null,
    });
    // Most points first.
    expect(built.courses.map((c) => c.trackId)).toEqual(['A', 'B']);
  });

  it('returns empty lists and zero counts with no enrolments', () => {
    const built = buildKnowledgeVsSkill([], [], [], opts);
    expect(built.points).toEqual([]);
    expect(built.courses).toEqual([]);
    expect(built.coverage).toEqual({
      courses: 0,
      enrolments: 0,
      points: 0,
      learners: 0,
      missingQuiz: 0,
      missingSkill: 0,
    });
    expect(built.overall).toEqual({
      points: 0,
      learners: 0,
      r: null,
      rCi: null,
      detectable: false,
    });
  });
});
