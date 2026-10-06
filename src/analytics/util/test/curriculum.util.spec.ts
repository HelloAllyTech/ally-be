import {
  buildCourseFunnel,
  classifyGateProgress,
  collapseQuizAttempts,
  COURSE_FUNNEL_CHART_COURSES,
  COURSE_FUNNEL_STALLED_AFTER_DAYS,
  FunnelEnrollmentRow,
  funnelStages,
  GateProgressRow,
  gateCalibration,
  isScoreGate,
  median,
  missedQuestions,
  QuizAttemptRow,
  quantile,
  ROLEPLAY_GATE_STUCK_AFTER_DAYS,
} from '../curriculum.util';

const NOW = new Date(Date.UTC(2026, 9, 5));
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const day = (n: number) => new Date(Date.UTC(2026, 6, 1 + n));

describe('quantile', () => {
  it('matches percentile_cont (linear interpolation)', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([4, 1, 3, 2], 0.25)).toBe(1.75);
    expect(quantile([7], 0.75)).toBe(7);
    expect(median([5, 1, 3])).toBe(3);
  });

  it('is null over nothing', () => {
    expect(quantile([], 0.5)).toBeNull();
  });
});

// ─── Course funnel ───────────────────────────────────────────────────────────

const enrol = (
  over: Partial<FunnelEnrollmentRow> = {},
): FunnelEnrollmentRow => ({
  trackId: 'track-a',
  title: 'Course A',
  status: 'ACTIVE',
  totalItems: 10,
  openedAnyItem: false,
  completedItems: 0,
  reachedHalf: false,
  completedAt: null,
  daysToComplete: null,
  lastActivityAt: daysAgo(1),
  ...over,
});

describe('funnelStages', () => {
  it('does not count an enrolment that never opened an item as started', () => {
    expect(funnelStages(enrol(), NOW)).toEqual({
      started: false,
      halfway: false,
      completed: false,
      stalled: false,
    });
  });

  it('counts opening an item as started', () => {
    expect(funnelStages(enrol({ openedAnyItem: true }), NOW).started).toBe(
      true,
    );
  });

  it('forces the stages monotone: finished implies halfway implies started', () => {
    const s = funnelStages(
      enrol({ completedAt: daysAgo(2), reachedHalf: false }),
      NOW,
    );
    expect(s).toEqual({
      started: true,
      halfway: true,
      completed: true,
      stalled: false,
    });
    expect(funnelStages(enrol({ reachedHalf: true }), NOW).started).toBe(true);
  });

  it('stalls a started, unfinished enrolment idle past the threshold', () => {
    const idle = enrol({
      openedAnyItem: true,
      lastActivityAt: daysAgo(COURSE_FUNNEL_STALLED_AFTER_DAYS + 1),
    });
    const recent = enrol({
      openedAnyItem: true,
      lastActivityAt: daysAgo(COURSE_FUNNEL_STALLED_AFTER_DAYS - 1),
    });
    const never = enrol({ openedAnyItem: true, lastActivityAt: null });
    expect(funnelStages(idle, NOW).stalled).toBe(true);
    expect(funnelStages(recent, NOW).stalled).toBe(false);
    expect(funnelStages(never, NOW).stalled).toBe(true);
  });

  it('never stalls a finished or an unstarted enrolment', () => {
    const old = daysAgo(COURSE_FUNNEL_STALLED_AFTER_DAYS + 10);
    expect(
      funnelStages(enrol({ completedAt: old, lastActivityAt: old }), NOW)
        .stalled,
    ).toBe(false);
    expect(funnelStages(enrol({ lastActivityAt: old }), NOW).stalled).toBe(
      false,
    );
  });
});

describe('buildCourseFunnel', () => {
  it('counts each stage and divides by enrolled (stalled by started)', () => {
    const rows = [
      enrol(), // enrolled only
      enrol({ openedAnyItem: true }), // started
      enrol({
        openedAnyItem: true,
        lastActivityAt: daysAgo(40),
      }), // started, stalled
      enrol({ openedAnyItem: true, reachedHalf: true }), // halfway
      enrol({
        openedAnyItem: true,
        reachedHalf: true,
        completedAt: daysAgo(1),
        daysToComplete: 4,
      }),
      enrol({
        openedAnyItem: true,
        reachedHalf: true,
        completedAt: daysAgo(1),
        daysToComplete: 8,
      }),
    ];
    const { courses, totals } = buildCourseFunnel(rows, NOW, 5);
    expect(courses[0]).toMatchObject({
      enrolled: 6,
      started: 5,
      halfway: 3,
      completed: 2,
      stalled: 1,
      startedPct: 83.3,
      halfwayPct: 50,
      completedPct: 33.3,
      stalledPct: 20,
      // Only two finishers: the median is a statement about two people.
      medianDaysToComplete: null,
      daysToCompleteIqr: null,
      inChart: true,
    });
    expect(totals).toEqual({
      courses: 1,
      enrolled: 6,
      started: 5,
      halfway: 3,
      completed: 2,
      stalled: 1,
    });
  });

  it('reports median and IQR days over finishers at the floor', () => {
    const rows = [2, 4, 6, 8, 10].map((d) =>
      enrol({ completedAt: daysAgo(1), daysToComplete: d }),
    );
    const [course] = buildCourseFunnel(rows, NOW, 5).courses;
    expect(course.medianDaysToComplete).toBe(6);
    expect(course.daysToCompleteIqr).toEqual([4, 8]);
  });

  it('withholds rates below the floor but keeps the counts', () => {
    const rows = [enrol({ openedAnyItem: true }), enrol()];
    const [course] = buildCourseFunnel(rows, NOW, 5).courses;
    expect(course).toMatchObject({
      enrolled: 2,
      started: 1,
      startedPct: null,
      completedPct: null,
      stalledPct: null,
    });
  });

  it('flags only the top courses by enrolments for the chart, listing the rest', () => {
    const rows: FunnelEnrollmentRow[] = [];
    for (let c = 0; c < COURSE_FUNNEL_CHART_COURSES + 2; c += 1) {
      for (let i = 0; i <= c; i += 1) {
        rows.push(enrol({ trackId: `t-${c}`, title: `Course ${c}` }));
      }
    }
    const { courses } = buildCourseFunnel(rows, NOW, 5);
    expect(courses).toHaveLength(COURSE_FUNNEL_CHART_COURSES + 2);
    expect(courses[0].enrolled).toBe(COURSE_FUNNEL_CHART_COURSES + 2);
    expect(courses.filter((c) => c.inChart)).toHaveLength(
      COURSE_FUNNEL_CHART_COURSES,
    );
    expect(courses.slice(-2).every((c) => !c.inChart)).toBe(true);
  });

  it('is empty over no enrolments', () => {
    expect(buildCourseFunnel([], NOW, 5)).toEqual({
      courses: [],
      totals: {
        courses: 0,
        enrolled: 0,
        started: 0,
        halfway: 0,
        completed: 0,
        stalled: 0,
      },
    });
  });
});

// ─── Quiz outcomes ───────────────────────────────────────────────────────────

let attemptSeq = 0;
const attempt = (over: Partial<QuizAttemptRow> = {}): QuizAttemptRow => {
  attemptSeq += 1;
  return {
    attemptId: `a-${attemptSeq}`,
    trackItemId: 'quiz-1',
    userId: 1,
    attemptNumber: 1,
    submittedAt: day(10),
    scorePct: 50,
    passed: false,
    grading: null,
    ...over,
  };
};

const START = day(0);
const END = day(30);

describe('collapseQuizAttempts', () => {
  it('collapses a learner to one outcome: first vs best', () => {
    const [o] = collapseQuizAttempts(
      [
        attempt({ attemptNumber: 1, scorePct: 40, passed: false }),
        attempt({
          attemptNumber: 2,
          submittedAt: day(11),
          scorePct: 90,
          passed: true,
        }),
        attempt({
          attemptNumber: 3,
          submittedAt: day(12),
          scorePct: 70,
          passed: true,
        }),
      ],
      START,
      END,
    );
    expect(o).toMatchObject({
      firstScore: 40,
      firstPassed: false,
      bestScore: 90,
      scoredAttempts: 3,
      retried: true,
      passedLater: true,
    });
  });

  it('leaves out a learner whose first attempt predates the window, even after re-enrolling', () => {
    const out = collapseQuizAttempts(
      [
        attempt({
          attemptNumber: 1,
          submittedAt: new Date(START.getTime() - 1),
        }),
        attempt({ attemptNumber: 1, submittedAt: day(5) }), // second enrolment
      ],
      START,
      END,
    );
    expect(out).toEqual([]);
  });

  it('uses the earliest first attempt when a learner has two', () => {
    const [o] = collapseQuizAttempts(
      [
        attempt({
          attemptNumber: 1,
          submittedAt: day(9),
          scorePct: 80,
          passed: true,
        }),
        attempt({
          attemptNumber: 1,
          submittedAt: day(3),
          scorePct: 20,
          passed: false,
        }),
      ],
      START,
      END,
    );
    expect(o.firstScore).toBe(20);
  });

  it('keeps a pending first attempt as unscored, never promoting attempt 2 to first', () => {
    const [o] = collapseQuizAttempts(
      [
        attempt({ attemptNumber: 1, scorePct: 60, passed: null }),
        attempt({
          attemptNumber: 2,
          submittedAt: day(11),
          scorePct: 90,
          passed: true,
        }),
      ],
      START,
      END,
    );
    expect(o.firstScore).toBeNull();
    expect(o.firstPassed).toBeNull();
    expect(o.passedLater).toBe(false);
  });

  it('treats a survey attempt (nothing graded) as unscored, not as a pass', () => {
    const [o] = collapseQuizAttempts(
      [attempt({ scorePct: null, passed: true })],
      START,
      END,
    );
    expect(o.firstScore).toBeNull();
    expect(o.firstPassed).toBeNull();
  });

  it('ignores attempts at or after the window end', () => {
    const [o] = collapseQuizAttempts(
      [
        attempt({ scorePct: 40 }),
        attempt({
          attemptNumber: 2,
          submittedAt: END,
          scorePct: 100,
          passed: true,
        }),
      ],
      START,
      END,
    );
    expect(o).toMatchObject({ bestScore: 40, retried: false });
  });

  it('keeps learners and quizzes apart', () => {
    const out = collapseQuizAttempts(
      [
        attempt({ userId: 1 }),
        attempt({ userId: 2 }),
        attempt({ userId: 1, trackItemId: 'quiz-2' }),
      ],
      START,
      END,
    );
    expect(out).toHaveLength(3);
  });
});

describe('missedQuestions', () => {
  const graded = (
    questionId: string,
    correct: boolean | null,
    g?: boolean,
  ) => ({
    questionId,
    correct,
    graded: g ?? null,
  });

  it('counts only graded first-attempt answers, by id and type', () => {
    const outcomes = collapseQuizAttempts(
      [
        attempt({
          userId: 1,
          grading: [
            graded('q1', false),
            graded('q2', true),
            graded('q3', null),
          ],
        }),
        attempt({
          userId: 2,
          grading: [
            graded('q1', false),
            graded('q2', false),
            graded('q4', false, false),
          ],
        }),
        // Unscored first attempt: no question counts.
        attempt({ userId: 3, passed: null, grading: [graded('q2', false)] }),
      ],
      START,
      END,
    );
    const out = missedQuestions(
      outcomes,
      [
        { id: 'q1', type: 'mcq_single', position: 1 },
        { id: 'q2', type: 'open_ended', position: 2 },
      ],
      1,
    );
    expect(out).toEqual([
      {
        questionId: 'q1',
        type: 'mcq_single',
        position: 1,
        wrong: 2,
        graded: 2,
        wrongPct: 100,
      },
      {
        questionId: 'q2',
        type: 'open_ended',
        position: 2,
        wrong: 1,
        graded: 2,
        wrongPct: 50,
      },
    ]);
  });

  it('withholds the share below the floor and caps the list', () => {
    const grading = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
      graded(id, false),
    );
    const outcomes = collapseQuizAttempts([attempt({ grading })], START, END);
    const out = missedQuestions(outcomes, [], 20);
    expect(out).toHaveLength(5);
    expect(out.every((q) => q.wrongPct === null && q.wrong === 1)).toBe(true);
    // A question no longer in the quiz keeps its id, with no type or position.
    expect(out[0]).toMatchObject({ type: null, position: null });
  });
});

// ─── Roleplay gates ──────────────────────────────────────────────────────────

const progress = (over: Partial<GateProgressRow> = {}): GateProgressRow => ({
  trackItemId: 'rp-1',
  status: 'UNLOCKED',
  completedAt: null,
  attemptCount: 1,
  sessions: 1,
  firstScore: 10,
  lastSessionAt: daysAgo(1),
  ...over,
});

describe('isScoreGate', () => {
  it('follows meetsMinimumScore: 0, negative or missing means no gate', () => {
    expect(isScoreGate(50)).toBe(true);
    expect(isScoreGate(0.5)).toBe(true);
    expect(isScoreGate(0)).toBe(false);
    expect(isScoreGate(-10)).toBe(false);
    expect(isScoreGate(null)).toBe(false);
    expect(isScoreGate(undefined)).toBe(false);
  });
});

describe('classifyGateProgress', () => {
  it('passes first time when completed and the first session cleared the bar', () => {
    expect(
      classifyGateProgress(
        progress({ status: 'COMPLETED', firstScore: 60 }),
        50,
        NOW,
      ),
    ).toBe('passedFirst');
  });

  it('passes later when completed but the first session fell short', () => {
    expect(
      classifyGateProgress(
        progress({ status: 'COMPLETED', firstScore: 30 }),
        50,
        NOW,
      ),
    ).toBe('passedLater');
  });

  it('reads a missing first score as 0, as the gate did', () => {
    expect(
      classifyGateProgress(
        progress({ status: 'COMPLETED', firstScore: null }),
        50,
        NOW,
      ),
    ).toBe('passedLater');
  });

  it('is stuck when unlocked, unfinished and idle past the threshold', () => {
    const idle = daysAgo(ROLEPLAY_GATE_STUCK_AFTER_DAYS + 1);
    expect(
      classifyGateProgress(progress({ lastSessionAt: idle }), 50, NOW),
    ).toBe('stuck');
    expect(
      classifyGateProgress(
        progress({
          lastSessionAt: daysAgo(ROLEPLAY_GATE_STUCK_AFTER_DAYS - 1),
        }),
        50,
        NOW,
      ),
    ).toBe('inProgress');
    // Not unlocked (an odd state) is never stuck.
    expect(
      classifyGateProgress(
        progress({ status: 'LOCKED', lastSessionAt: idle }),
        50,
        NOW,
      ),
    ).toBe('inProgress');
  });
});

describe('gateCalibration', () => {
  it('flags outside the 40–95% band, never when withheld', () => {
    expect(gateCalibration(39.9)).toBe('tooHard');
    expect(gateCalibration(40)).toBeNull();
    expect(gateCalibration(95)).toBeNull();
    expect(gateCalibration(95.1)).toBe('tooEasy');
    expect(gateCalibration(null)).toBeNull();
  });
});
