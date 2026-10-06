import { MIN_COHORT_SIZE } from '../../repository/cohort-analytics.repository';
import { GatedRoleplayItemRow } from '../../repository/curriculum-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import {
  GateProgressRow,
  QuizAttemptRow,
  QuizItemRow,
} from '../../util/curriculum.util';
import {
  buildQuizOutcomes,
  buildRoleplayGates,
  CurriculumAnalyticsService,
} from '../curriculum-analytics.service';

const day = (n: number) => new Date(Date.UTC(2026, 6, 1 + n));
const START = day(0);
const END = day(60);
const NOW = day(90);

// ─── Quiz outcomes ───────────────────────────────────────────────────────────

const quiz = (id: string, title = id): QuizItemRow => ({
  trackItemId: id,
  title,
  trackId: 'track-a',
  trackTitle: 'Course A',
  questions: [
    { id: 'q1', type: 'mcq_single', position: 1 },
    { id: 'q2', type: 'open_ended', position: 2 },
  ],
});

let seq = 0;
const attempt = (over: Partial<QuizAttemptRow>): QuizAttemptRow => {
  seq += 1;
  return {
    attemptId: `a-${seq}`,
    trackItemId: 'quiz-hard',
    userId: 1,
    attemptNumber: 1,
    submittedAt: day(10),
    scorePct: 50,
    passed: false,
    grading: null,
    ...over,
  };
};

/**
 * `n` learners on `itemId`; `passFirst(i)` decides their first attempt; those
 * who fail retry once at `retryScore`.
 */
function learners(
  itemId: string,
  n: number,
  passFirst: (i: number) => boolean,
  firstUserId = 1,
): QuizAttemptRow[] {
  const rows: QuizAttemptRow[] = [];
  for (let i = 0; i < n; i += 1) {
    const userId = firstUserId + i;
    const passed = passFirst(i);
    rows.push(
      attempt({
        trackItemId: itemId,
        userId,
        scorePct: passed ? 90 : 40,
        passed,
        grading: [
          { questionId: 'q1', correct: passed, graded: true },
          { questionId: 'q2', correct: true, graded: true },
        ],
      }),
    );
    if (!passed) {
      rows.push(
        attempt({
          trackItemId: itemId,
          userId,
          attemptNumber: 2,
          submittedAt: day(12),
          scorePct: 80,
          passed: true,
        }),
      );
    }
  }
  return rows;
}

describe('buildQuizOutcomes', () => {
  const items = [quiz('quiz-hard'), quiz('quiz-easy'), quiz('quiz-thin')];
  const attempts = [
    ...learners('quiz-hard', MIN_SCORE_SAMPLE_SIZE, (i) => i < 5),
    ...learners('quiz-easy', MIN_SCORE_SAMPLE_SIZE, (i) => i < 18, 1000),
    ...learners('quiz-thin', 3, () => false, 2000),
  ];
  const { quizzes, summary } = buildQuizOutcomes(
    items,
    attempts,
    START,
    END,
    MIN_SCORE_SAMPLE_SIZE,
  );

  it('sorts hardest first and withheld last', () => {
    expect(quizzes.map((q) => q.trackItemId)).toEqual([
      'quiz-hard',
      'quiz-easy',
      'quiz-thin',
    ]);
    expect(summary).toEqual({
      quizzes: 3,
      measurable: 2,
      firstAttempts: MIN_SCORE_SAMPLE_SIZE * 2 + 3,
    });
  });

  it('reports first-attempt pass, retries and passing later per learner', () => {
    expect(quizzes[0]).toMatchObject({
      firstAttempts: MIN_SCORE_SAMPLE_SIZE,
      unscoredFirstAttempts: 0,
      passedFirst: 5,
      passedFirstPct: 25,
      retried: 15,
      retriedPct: 75,
      passedLater: 15,
      withheld: false,
    });
  });

  it('pairs first against best over the learners who retried, floored on them', () => {
    // quiz-hard: 15 retried — below the floor of 20, so withheld though the quiz is not.
    expect(quizzes[0].firstToBest).toMatchObject({
      learners: 15,
      firstAvg: null,
      change: null,
      up: 15,
      down: 0,
      tied: 0,
    });
    const many = buildQuizOutcomes(
      [quiz('q')],
      learners('q', MIN_SCORE_SAMPLE_SIZE, () => false),
      START,
      END,
      MIN_SCORE_SAMPLE_SIZE,
    ).quizzes[0];
    expect(many.firstToBest).toMatchObject({
      learners: MIN_SCORE_SAMPLE_SIZE,
      firstAvg: 40,
      bestAvg: 80,
      change: 40,
      detectable: true,
    });
  });

  it('withholds every rate below the floor while counts travel', () => {
    expect(quizzes[2]).toMatchObject({
      firstAttempts: 3,
      passedFirst: 0,
      passedFirstPct: null,
      retriedPct: null,
      retried: 3,
      withheld: true,
    });
    expect(quizzes[2].missedQuestions[0]).toMatchObject({
      questionId: 'q1',
      wrong: 3,
      wrongPct: null,
    });
  });

  it('lists the questions most often wrong first time, by id and type', () => {
    expect(quizzes[0].missedQuestions).toEqual([
      {
        questionId: 'q1',
        type: 'mcq_single',
        position: 1,
        wrong: 15,
        graded: MIN_SCORE_SAMPLE_SIZE,
        wrongPct: 75,
      },
    ]);
  });

  it('never carries quiz or answer text', () => {
    const json = JSON.stringify(quizzes);
    for (const key of ['prompt', 'feedback', 'answers', 'text', 'options']) {
      expect(json).not.toContain(`"${key}"`);
    }
  });

  it('skips a quiz no longer in the live catalogue', () => {
    const out = buildQuizOutcomes(
      [],
      learners('gone', 3, () => true),
      START,
      END,
      MIN_SCORE_SAMPLE_SIZE,
    );
    expect(out.quizzes).toEqual([]);
  });
});

// ─── Roleplay gates ──────────────────────────────────────────────────────────

const gate = (
  id: string,
  minScore: number,
  title = id,
): GatedRoleplayItemRow => ({
  trackItemId: id,
  title,
  trackId: 'track-a',
  trackTitle: 'Course A',
  scenarioId: 7,
  minScore,
});

const row = (
  trackItemId: string,
  over: Partial<GateProgressRow> = {},
): GateProgressRow => ({
  trackItemId,
  status: 'UNLOCKED',
  completedAt: null,
  attemptCount: 1,
  sessions: 1,
  firstScore: 0,
  lastSessionAt: day(89),
  ...over,
});

/** `n` rows: the first `first` pass first time, the next `later` pass on attempt 3, the rest stuck. */
function rows(id: string, n: number, first: number, later: number) {
  return Array.from({ length: n }, (_, i) => {
    if (i < first)
      return row(id, { status: 'COMPLETED', firstScore: 60, attemptCount: 1 });
    if (i < first + later)
      return row(id, {
        status: 'COMPLETED',
        firstScore: 20,
        attemptCount: 3,
        sessions: 3,
      });
    return row(id, { lastSessionAt: day(30) });
  });
}

describe('buildRoleplayGates', () => {
  it('classifies each row and shares over attempted progress rows', () => {
    const { items } = buildRoleplayGates(
      [gate('rp-1', 50)],
      rows('rp-1', MIN_SCORE_SAMPLE_SIZE, 10, 6),
      NOW,
      MIN_SCORE_SAMPLE_SIZE,
      MIN_COHORT_SIZE,
    );
    expect(items[0]).toMatchObject({
      progressRows: MIN_SCORE_SAMPLE_SIZE,
      passedFirst: 10,
      passedLater: 6,
      stuck: 4,
      inProgress: 0,
      passedFirstPct: 50,
      passedLaterPct: 30,
      stuckPct: 20,
      inProgressPct: 0,
      // attempts: ten 1s and six 3s → median 1
      medianAttemptsToPass: 1,
      calibration: null,
      withheld: false,
    });
  });

  it('flags a gate that is too hard or too easy for its scenario', () => {
    const { items, summary } = buildRoleplayGates(
      [gate('hard', 50), gate('easy', 50)],
      [
        ...rows('hard', MIN_SCORE_SAMPLE_SIZE, 2, 10),
        ...rows('easy', MIN_SCORE_SAMPLE_SIZE, MIN_SCORE_SAMPLE_SIZE, 0),
      ],
      NOW,
      MIN_SCORE_SAMPLE_SIZE,
      MIN_COHORT_SIZE,
    );
    expect(items.map((g) => [g.trackItemId, g.calibration])).toEqual([
      ['hard', 'tooHard'],
      ['easy', 'tooEasy'],
    ]);
    expect(summary).toMatchObject({ measurable: 2, tooHard: 1, tooEasy: 1 });
  });

  it('treats minScore 0 (and below) as no gate, per meetsMinimumScore', () => {
    const { items, summary } = buildRoleplayGates(
      [gate('zero', 0), gate('negative', -5), gate('real', 10)],
      [
        ...rows('zero', 3, 3, 0),
        ...rows('negative', 3, 3, 0),
        ...rows('real', 3, 1, 1),
      ],
      NOW,
      MIN_SCORE_SAMPLE_SIZE,
      MIN_COHORT_SIZE,
    );
    expect(items.map((g) => g.trackItemId)).toEqual(['real']);
    expect(summary.ungatedItems).toBe(2);
  });

  it('withholds shares, median and flag below the floor while counts travel', () => {
    const { items } = buildRoleplayGates(
      [gate('rp-1', 50)],
      rows('rp-1', 4, 0, 0),
      NOW,
      MIN_SCORE_SAMPLE_SIZE,
      MIN_COHORT_SIZE,
    );
    expect(items[0]).toMatchObject({
      progressRows: 4,
      stuck: 4,
      passedFirstPct: null,
      stuckPct: null,
      medianAttemptsToPass: null,
      calibration: null,
      withheld: true,
    });
  });

  it('withholds the median below the completion floor even when the item is measurable', () => {
    const { items } = buildRoleplayGates(
      [gate('rp-1', 50)],
      rows('rp-1', MIN_SCORE_SAMPLE_SIZE, MIN_COHORT_SIZE - 1, 0),
      NOW,
      MIN_SCORE_SAMPLE_SIZE,
      MIN_COHORT_SIZE,
    );
    expect(items[0].withheld).toBe(false);
    expect(items[0].medianAttemptsToPass).toBeNull();
  });

  it('lists only items someone has attempted', () => {
    const { items, summary } = buildRoleplayGates(
      [gate('untried', 50)],
      [],
      NOW,
      MIN_SCORE_SAMPLE_SIZE,
      MIN_COHORT_SIZE,
    );
    expect(items).toEqual([]);
    expect(summary).toEqual({
      items: 0,
      measurable: 0,
      tooHard: 0,
      tooEasy: 0,
      progressRows: 0,
      ungatedItems: 0,
    });
  });
});

// ─── Service ─────────────────────────────────────────────────────────────────

describe('CurriculumAnalyticsService', () => {
  const build = () => {
    const repository = {
      getDataFloor: jest.fn().mockResolvedValue(new Date('2025-01-01')),
      getFunnelEnrollments: jest.fn().mockResolvedValue([]),
      getQuizItems: jest.fn().mockResolvedValue([]),
      getQuizAttempts: jest.fn().mockResolvedValue([]),
      getGatedRoleplayItems: jest.fn().mockResolvedValue([]),
      getGateProgress: jest.fn().mockResolvedValue([]),
    };
    return {
      repository,
      service: new CurriculumAnalyticsService(repository as any),
    };
  };

  it('defaults the course funnel to a 12-month window and scopes by org', async () => {
    const { repository, service } = build();
    const res = await service.getCourseFunnel({ tenantId: 'org-1' });
    expect(res.window.label).toBe('Last 12 months');
    const [start, end, tenant] = repository.getFunnelEnrollments.mock.calls[0];
    expect(start).toBeInstanceOf(Date);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(tenant).toBe('org-1');
    expect(repository.getDataFloor).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      minCohortSize: MIN_COHORT_SIZE,
      courses: [],
      totals: { courses: 0, enrolled: 0, completedPct: null, stalledPct: null },
      scoping: { tenantId: 'org-1', unscopedSections: [] },
    });
    expect(res.provenance.derivation).toContain('R10');
  });

  it('measures the data floor only for an all-time window', async () => {
    const { repository, service } = build();
    await service.getQuizOutcomes({ range: 'all' });
    expect(repository.getDataFloor).toHaveBeenCalled();
    const [start] = repository.getQuizAttempts.mock.calls[0];
    expect((start as Date).toISOString().slice(0, 10)).toBe('2025-01-01');
  });

  it('returns well-formed empty quiz outcomes with the grader caveat', async () => {
    const { service } = build();
    const res = await service.getQuizOutcomes({});
    expect(res).toMatchObject({
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: [0, 100],
      quizzes: [],
      summary: { quizzes: 0, measurable: 0, firstAttempts: 0 },
      scoping: { tenantId: null },
    });
    expect(res.provenance.note).toContain('track-quiz-grading');
  });

  it('returns well-formed empty roleplay gates with the scale caveat', async () => {
    const { repository, service } = build();
    const res = await service.getRoleplayGates({ tenantId: 'org-2' });
    expect(repository.getGateProgress).toHaveBeenCalledWith('org-2');
    expect(res).toMatchObject({
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      calibrationBand: { tooHardBelowPct: 40, tooEasyAbovePct: 95 },
      items: [],
      scoping: { tenantId: 'org-2' },
    });
    expect(res.provenance.note).toContain('scenario-scaled');
  });
});
