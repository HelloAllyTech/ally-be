import { DataSource } from 'typeorm';

import { CourseProgressAnalyticsRepository } from '../course-progress-analytics.repository';

/**
 * The two Curriculum reads behind AAQ-225 and AAQ-226. Every learner-bearing
 * query must exclude test orgs by the learner, narrow by the learner's org
 * with the id as a BOUND parameter (never interpolated), skip soft-deleted
 * rows, and — for the helping-skills slices — pin the rubric.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE_BY_USER = 'EXISTS (SELECT 1 FROM users stu';
const TEST_ORG = '"isTestOrganization" = true';
/** Live and archived courses — the course funnel's set; never DRAFT. */
const STATUSES = ['ACTIVE', 'ARCHIVED'];

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repository = new CourseProgressAnalyticsRepository({
    query,
  } as unknown as DataSource);
  return { query, repository };
};

const lastCall = (query: jest.Mock) => {
  const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
  return { sql: String(sql), params: (params ?? []) as unknown[] };
};

describe('CourseProgressAnalyticsRepository.getLiveTrackItems', () => {
  it('reads live items in live sections of live courses, with both order columns', async () => {
    const { query, repository } = build();
    await repository.getLiveTrackItems();
    const { sql, params } = lastCall(query);
    expect(params).toEqual([STATUSES]);
    expect(sql).toContain('t.status = ANY($1)');
    expect(sql).toContain('i."deletedAt" IS NULL');
    expect(sql).toContain('s."deletedAt" IS NULL');
    expect(sql).toContain('t."deletedAt" IS NULL');
    expect(sql).toContain('s."order" AS section_order');
    expect(sql).toContain('i."order" AS item_order');
  });

  it('maps rows to items', async () => {
    const { repository } = build([
      {
        track_id: 't1',
        item_id: 'i1',
        title: null,
        type: 'QUIZ',
        section_id: 's1',
        section_order: '2',
        item_order: 3,
      },
    ]);
    expect(await repository.getLiveTrackItems()).toEqual([
      {
        trackId: 't1',
        itemId: 'i1',
        title: 'Untitled item',
        type: 'QUIZ',
        sectionId: 's1',
        sectionOrder: 2,
        itemOrder: 3,
      },
    ]);
  });
});

describe('CourseProgressAnalyticsRepository.getProgressEnrollments', () => {
  it('excludes test orgs by the learner and changes nothing without a tenant', async () => {
    const { query, repository } = build();
    await repository.getProgressEnrollments();
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['LOCKED', 'COMPLETED', STATUSES]);
    expect(sql).toContain('t.status = ANY($3)');
    expect(sql).toContain(TEST_ORG);
    expect(sql).toContain('ttu.id = e."userId"');
    expect(sql).not.toContain(SCOPE_BY_USER);
    expect(sql).toContain('e."deletedAt" IS NULL');
    expect(sql).toContain('p."deletedAt" IS NULL');
    expect(sql).toContain('t."deletedAt" IS NULL');
    // Reached = not LOCKED; started = opened or completed.
    expect(sql).toContain('FILTER (WHERE p.status <> $1)');
    expect(sql).toContain('p."startedAt" IS NOT NULL OR p.status = $2');
  });

  it("narrows by the learner's org, bound as $4", async () => {
    const { query, repository } = build();
    await repository.getProgressEnrollments(TENANT);
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['LOCKED', 'COMPLETED', STATUSES, TENANT]);
    expect(sql).toContain(SCOPE_BY_USER);
    expect(sql).toContain('stu.id = e."userId"');
    expect(sql).toContain('st.id::text = $4 OR st.code = $4');
    expect(sql).toContain(TEST_ORG);
    expect(sql).not.toContain(TENANT);
  });

  it('maps progress arrays whether the driver parsed them or not', async () => {
    const { repository } = build([
      {
        enrollment_id: 'e1',
        track_id: 't1',
        title: 'Course',
        status: 'ACTIVE',
        completed_at: null,
        completed_items: '1',
        reached_item_ids: ['a', 'b'],
        opened_item_ids: '{a}',
        opened_any: true,
      },
      {
        enrollment_id: 'e2',
        track_id: 't1',
        title: null,
        status: 'ACTIVE',
        completed_at: '2026-07-01T00:00:00Z',
        completed_items: 2,
        reached_item_ids: '{}',
        opened_item_ids: [],
        opened_any: false,
      },
    ]);
    const [a, b] = await repository.getProgressEnrollments();
    expect(a).toEqual({
      enrollmentId: 'e1',
      trackId: 't1',
      title: 'Course',
      status: 'ACTIVE',
      completedAt: null,
      completedItems: 1,
      openedAny: true,
      reachedItemIds: ['a', 'b'],
      openedItemIds: ['a'],
    });
    expect(b.title).toBe('Untitled course');
    expect(b.completedAt).toEqual(new Date('2026-07-01T00:00:00Z'));
    expect(b.reachedItemIds).toEqual([]);
  });
});

describe('CourseProgressAnalyticsRepository.getQuizCourseEnrollments', () => {
  it('reads live enrolments in courses with a live quiz, test orgs excluded', async () => {
    const { query, repository } = build();
    await repository.getQuizCourseEnrollments();
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['QUIZ', STATUSES]);
    expect(sql).toContain('t.status = ANY($2)');
    expect(sql).toContain('e."deletedAt" IS NULL');
    expect(sql).toContain('qi."deletedAt" IS NULL');
    expect(sql).toContain('qs."deletedAt" IS NULL');
    expect(sql).toContain('qi.type = $1');
    expect(sql).toContain(TEST_ORG);
    expect(sql).not.toContain(SCOPE_BY_USER);
  });

  it("narrows by the learner's org, bound as $3", async () => {
    const { query, repository } = build();
    await repository.getQuizCourseEnrollments(TENANT);
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['QUIZ', STATUSES, TENANT]);
    expect(sql).toContain('st.id::text = $3 OR st.code = $3');
    expect(sql).not.toContain(TENANT);
  });
});

describe('CourseProgressAnalyticsRepository.getFirstQuizAttempts', () => {
  it('reads the earliest live first attempt per learner per live quiz', async () => {
    const { query, repository } = build();
    await repository.getFirstQuizAttempts();
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['QUIZ', STATUSES]);
    expect(sql).toContain('t.status = ANY($2)');
    expect(sql).toContain('DISTINCT ON (q."trackItemId", q."userId")');
    expect(sql).toContain('q."attemptNumber" = 1');
    expect(sql).toContain('q."deletedAt" IS NULL');
    expect(sql).toContain('i."deletedAt" IS NULL');
    expect(sql).toContain('s."deletedAt" IS NULL');
    expect(sql).toContain('t."deletedAt" IS NULL');
    expect(sql).toContain('q."submittedAt" ASC NULLS LAST');
    expect(sql).toContain('ttu.id = q."userId"');
    // Scores only — never the learner's answers or grading.
    expect(sql).not.toMatch(/q\."answers"|q\.answers|q\.grading|q\."grading"/);
  });

  it("narrows by the learner's org, bound as $3", async () => {
    const { query, repository } = build();
    await repository.getFirstQuizAttempts(TENANT);
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['QUIZ', STATUSES, TENANT]);
    expect(sql).toContain('st.id::text = $3 OR st.code = $3');
    expect(sql).toContain('stu.id = q."userId"');
    expect(sql).not.toContain(TENANT);
  });

  it('keeps an unscored first attempt as null rather than dropping it', async () => {
    const { repository } = build([
      {
        track_id: 't1',
        track_item_id: 'q1',
        user_id: '7',
        score_pct: null,
        passed: null,
      },
    ]);
    expect(await repository.getFirstQuizAttempts()).toEqual([
      {
        trackId: 't1',
        trackItemId: 'q1',
        userId: 7,
        scorePct: null,
        passed: null,
      },
    ]);
  });
});

describe('CourseProgressAnalyticsRepository.getScoredCuts', () => {
  it('pins the rubric, reads scored slices only and excludes test orgs twice', async () => {
    const { query, repository } = build();
    await repository.getScoredCuts('fhs-text-v1');
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['fhs-text-v1']);
    expect(sql).toContain('a."rubricVersion" = $1');
    expect(sql).toContain("a.status = 'SCORED'");
    expect(sql).toContain('a."compositeScore" IS NOT NULL');
    // The slice's own tenant, and the learner's.
    expect(sql).toContain('(c."tenant_id")::text');
    expect(sql).toContain('ttu.id = e."userId"');
    expect(sql).toContain('e."deletedAt" IS NULL');
    expect(sql).toContain('fs."endedAt" AS first_ended_at');
    expect(sql).not.toContain(SCOPE_BY_USER);
  });

  it('narrows to learners of one org, bound as $2', async () => {
    const { query, repository } = build();
    await repository.getScoredCuts('fhs-text-v1', TENANT);
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['fhs-text-v1', TENANT]);
    expect(sql).toContain('st.id::text = $2 OR st.code = $2');
    expect(sql).toContain(TEST_ORG);
    expect(sql).not.toContain(TENANT);
  });

  it('maps the slice timing fields', async () => {
    const { repository } = build([
      {
        user_id: 3,
        closed_at: '2026-07-02T00:00:00Z',
        first_ended_at: null,
        composite: '2.5',
      },
    ]);
    expect(await repository.getScoredCuts('v')).toEqual([
      {
        userId: 3,
        closedAt: new Date('2026-07-02T00:00:00Z'),
        firstEndedAt: null,
        composite: 2.5,
      },
    ]);
  });
});
