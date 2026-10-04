import {
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { COURSE_IMPACT_WINDOW_CUTS } from '../../constants/course-impact.constants';
import {
  CourseImpactCompetencyRow,
  CourseImpactCutRow,
  CourseImpactEnrollmentRow,
} from '../../repository/course-impact-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import {
  buildCourseImpact,
  CourseImpactAnalyticsService,
  courseSides,
} from '../course-impact-analytics.service';

const day = (n: number) => new Date(Date.UTC(2026, 6, 1 + n));

/** A slice whose sessions all ended on `endedDay` (first and closing alike). */
const cut = (
  userId: number,
  endedDay: number,
  composite: number,
  extra: Partial<CourseImpactCutRow> = {},
): CourseImpactCutRow => ({
  userId,
  closedAt: day(endedDay),
  firstEndedAt: day(endedDay),
  composite,
  unhelpful: false,
  levels: { verbal: Math.round(composite) },
  ...extra,
});

const enrollment = (
  userId: number,
  startedDay: number | null,
  completedDay: number | null,
  trackId = 'track-a',
): CourseImpactEnrollmentRow => ({
  trackId,
  title: trackId === 'track-a' ? 'Course A' : 'Course B',
  status: 'ACTIVE',
  userId,
  startedAt: startedDay === null ? null : day(startedDay),
  completedAt: completedDay === null ? null : day(completedDay),
});

const opts = {
  window: COURSE_IMPACT_WINDOW_CUTS,
  floor: MIN_SCORE_SAMPLE_SIZE,
};

/** `n` learners each enrolled day 10–20, with one slice before and one after. */
function cohort(
  n: number,
  before: (i: number) => number,
  after: (i: number) => number,
  trackId = 'track-a',
  firstUserId = 1,
) {
  const enrollments: CourseImpactEnrollmentRow[] = [];
  const cuts: CourseImpactCutRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const userId = firstUserId + i;
    enrollments.push(enrollment(userId, 10, 20, trackId));
    cuts.push(cut(userId, 5, before(i)), cut(userId, 25, after(i)));
  }
  return { enrollments, cuts };
}

describe('courseSides', () => {
  it('takes the LAST slices before the start and the FIRST after the finish', () => {
    const cuts = [1, 2, 3, 4, 5]
      .map((d) => cut(1, d, d))
      .concat([12, 15].map((d) => cut(1, d, d)))
      .concat([21, 22, 23, 24, 25].map((d) => cut(1, d, d)));
    const sides = courseSides(day(10), day(20), cuts, 3);
    expect(sides.before.map((c) => c.composite)).toEqual([3, 4, 5]);
    expect(sides.after.map((c) => c.composite)).toEqual([21, 22, 23]);
  });

  it('puts a slice that straddles the finish on neither side', () => {
    const straddle = cut(1, 21, 3, { firstEndedAt: day(19) });
    const sides = courseSides(day(10), day(20), [straddle], 3);
    expect(sides.after).toEqual([]);
  });

  it('puts a slice that closed after the start on neither side', () => {
    const sides = courseSides(day(10), day(20), [cut(1, 11, 3)], 3);
    expect(sides.before).toEqual([]);
    expect(sides.after).toEqual([]);
  });

  it('gives no after side until the learner has finished', () => {
    const sides = courseSides(day(10), null, [cut(1, 5, 2), cut(1, 25, 3)], 3);
    expect(sides.before).toHaveLength(1);
    expect(sides.after).toEqual([]);
  });

  it('cannot place a slice whose first session is gone', () => {
    const sides = courseSides(
      day(10),
      day(20),
      [cut(1, 25, 3, { firstEndedAt: null })],
      3,
    );
    expect(sides.after).toEqual([]);
  });

  it('gives nothing to a learner who never started', () => {
    expect(courseSides(null, null, [cut(1, 5, 2)], 3)).toEqual({
      before: [],
      after: [],
    });
  });
});

describe('buildCourseImpact', () => {
  it('walks the coverage funnel from enrolled to paired', () => {
    const { courses } = buildCourseImpact(
      [
        enrollment(1, null, null), // enrolled only
        enrollment(2, 10, null), // started
        enrollment(3, 10, 20), // finished, no practice before
        enrollment(4, 10, 20), // finished, baseline, nothing after
        enrollment(5, 10, 20), // paired
      ],
      [cut(4, 5, 2), cut(5, 5, 2), cut(5, 25, 3)],
      [],
      opts,
    );
    expect(courses[0].coverage).toEqual({
      enrolled: 5,
      started: 4,
      completed: 3,
      withBaseline: 2,
      paired: 1,
    });
  });

  it('withholds averages below the floor while counts travel', () => {
    const { enrollments, cuts } = cohort(
      MIN_SCORE_SAMPLE_SIZE - 1,
      () => 2,
      () => 3,
    );
    const { courses, summary } = buildCourseImpact(enrollments, cuts, [], opts);
    expect(courses[0].composite).toMatchObject({
      learners: MIN_SCORE_SAMPLE_SIZE - 1,
      beforeAvg: null,
      afterAvg: null,
      change: null,
      changeCi: null,
      up: MIN_SCORE_SAMPLE_SIZE - 1,
      detectable: false,
    });
    expect(summary.measurable).toBe(0);
  });

  it('pairs each learner with themselves and classifies the course', () => {
    const up = cohort(
      MIN_SCORE_SAMPLE_SIZE,
      () => 2,
      (i) => 2.5 + (i % 3) * 0.1,
    );
    const flat = cohort(
      MIN_SCORE_SAMPLE_SIZE,
      () => 2,
      (i) => (i % 2 ? 2.2 : 1.8),
      'track-b',
      1000,
    );
    const { courses, summary } = buildCourseImpact(
      [...up.enrollments, ...flat.enrollments],
      [...up.cuts, ...flat.cuts],
      [],
      opts,
    );
    const a = courses.find((c) => c.trackId === 'track-a')!;
    expect(a.composite.beforeAvg).toBe(2);
    expect(a.composite.change).toBeGreaterThan(0.5);
    expect(a.composite.detectable).toBe(true);
    const b = courses.find((c) => c.trackId === 'track-b')!;
    expect(b.composite.detectable).toBe(false);
    expect(summary).toEqual({
      courses: 2,
      measurable: 2,
      improved: 1,
      declined: 0,
      unclear: 1,
      pairedEnrollments: MIN_SCORE_SAMPLE_SIZE * 2,
    });
  });

  it('averages up to the window on each side', () => {
    const enrollments = Array.from({ length: MIN_SCORE_SAMPLE_SIZE }, (_, i) =>
      enrollment(i + 1, 10, 20),
    );
    const cuts = enrollments.flatMap((e) => [
      cut(e.userId, 1, 4), // outside the window: last 3 before are days 7–9
      cut(e.userId, 7, 2),
      cut(e.userId, 8, 2),
      cut(e.userId, 9, 2),
      cut(e.userId, 21, 3),
      cut(e.userId, 22, 3),
      cut(e.userId, 23, 3),
      cut(e.userId, 30, 1), // outside the window: first 3 after are days 21–23
    ]);
    const { courses } = buildCourseImpact(enrollments, cuts, [], opts);
    expect(courses[0].composite.beforeAvg).toBe(2);
    expect(courses[0].composite.afterAvg).toBe(3);
  });

  it('orders courses by paired learners, then enrollments', () => {
    const { courses } = buildCourseImpact(
      [
        enrollment(1, 10, 20, 'track-a'),
        enrollment(2, null, null, 'track-a'),
        enrollment(3, 10, 20, 'track-b'),
      ],
      [cut(3, 5, 2), cut(3, 25, 3)],
      [],
      opts,
    );
    expect(courses.map((c) => c.trackId)).toEqual(['track-b', 'track-a']);
  });

  it('maps seeded competencies to targeted skills in rubric order, ignoring the rest', () => {
    const competencies: CourseImpactCompetencyRow[] = [
      { trackId: 'track-a', name: 'Promote Realistic Hope' },
      { trackId: 'track-a', name: 'Verbal Communication' },
      { trackId: 'track-a', name: 'Non-Verbal Communication' },
      { trackId: 'track-a', name: 'Linking Emotions, Thoughts & Behaviours' },
      { trackId: 'track-a', name: 'Some admin-made competency' },
    ];
    const { courses } = buildCourseImpact(
      [enrollment(1, 10, 20)],
      [],
      competencies,
      opts,
    );
    expect(courses[0].targetedSkills).toEqual(['verbal', 'hope']);
  });

  it('returns the chosen course skill by skill, only where assessable on both sides', () => {
    const enrollments = Array.from({ length: MIN_SCORE_SAMPLE_SIZE }, (_, i) =>
      enrollment(i + 1, 10, 20),
    );
    const cuts = enrollments.flatMap((e) => [
      cut(e.userId, 5, 2, {
        levels: { verbal: 2, empathy: 2 },
        unhelpful: true,
      }),
      // empathy had no opportunity after the course: absent, not low
      cut(e.userId, 25, 3, { levels: { verbal: 3 }, unhelpful: false }),
    ]);
    const { course } = buildCourseImpact(
      enrollments,
      cuts,
      [{ trackId: 'track-a', name: 'Verbal Communication' }],
      { ...opts, trackId: 'track-a' },
    );
    expect(course).not.toBeNull();
    expect(course!.competencies).toEqual(['Verbal Communication']);
    expect(course!.skills.map((s) => s.skill)).toEqual(
      FHS_RUBRIC.map((s) => s.key),
    );
    const verbal = course!.skills.find((s) => s.skill === 'verbal')!;
    expect(verbal.targeted).toBe(true);
    expect(verbal.comparison).toMatchObject({
      learners: MIN_SCORE_SAMPLE_SIZE,
      beforeAvg: 2,
      afterAvg: 3,
      change: 1,
      detectable: true,
    });
    const empathy = course!.skills.find((s) => s.skill === 'empathy')!;
    expect(empathy.targeted).toBe(false);
    expect(empathy.comparison.learners).toBe(0);
    expect(course!.unhelpful).toMatchObject({
      beforeAvg: 1,
      afterAvg: 0,
      change: -1,
      down: MIN_SCORE_SAMPLE_SIZE,
    });
  });

  it('has no detail without a trackId, or for a course nobody enrolled in', () => {
    const rows = [enrollment(1, 10, 20)];
    expect(buildCourseImpact(rows, [], [], opts).course).toBeNull();
    expect(
      buildCourseImpact(rows, [], [], { ...opts, trackId: 'track-z' }).course,
    ).toBeNull();
  });
});

describe('CourseImpactAnalyticsService', () => {
  it('returns an empty, well-formed response with no enrollments', async () => {
    const repository = {
      getEnrollments: jest.fn().mockResolvedValue([]),
      getScoredCuts: jest.fn().mockResolvedValue([]),
      getCourseCompetencies: jest.fn().mockResolvedValue([]),
    };
    const service = new CourseImpactAnalyticsService(repository as any);
    const res = await service.getCourseImpact({ tenantId: 'org-1' });

    expect(repository.getEnrollments).toHaveBeenCalledWith('org-1');
    expect(repository.getScoredCuts).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      'org-1',
    );
    expect(res).toMatchObject({
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: [1, 4],
      windowCuts: COURSE_IMPACT_WINDOW_CUTS,
      courses: [],
      course: null,
      summary: {
        courses: 0,
        measurable: 0,
        improved: 0,
        declined: 0,
        unclear: 0,
        pairedEnrollments: 0,
      },
    });
    expect(res.provenance).toContain('Not a controlled comparison');
  });
});
