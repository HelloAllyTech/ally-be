import { DataSource } from 'typeorm';

import { CourseImpactAnalyticsRepository } from '../course-impact-analytics.repository';
import { CurriculumAnalyticsRepository } from '../curriculum-analytics.repository';

/**
 * Highlights → Curriculum and the course-impact reference: every read keeps
 * the test-org exclusion, narrows by the LEARNER's org with the id as a BOUND
 * parameter (never interpolated), drops soft-deleted rows, and never selects
 * quiz text, answers or grader feedback.
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE = 'EXISTS (SELECT 1 FROM users stu';
const TEST_ORGS = '"isTestOrganization" = true';
const START = new Date('2026-01-01T00:00:00Z');
const END = new Date('2026-02-01T00:00:00Z');

const build = () => {
  const query = jest.fn().mockResolvedValue([]);
  const dataSource = { query } as unknown as DataSource;
  return {
    query,
    repository: new CurriculumAnalyticsRepository(dataSource),
    courseImpact: new CourseImpactAnalyticsRepository(dataSource),
  };
};

const lastCall = (query: jest.Mock) => {
  const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
  return { sql: String(sql), params: (params ?? []) as unknown[] };
};

describe('CurriculumAnalyticsRepository.getFunnelEnrollments', () => {
  it('reads enrolments created in the window, test orgs out, no org filter by default', async () => {
    const { query, repository } = build();
    await repository.getFunnelEnrollments(START, END);
    const { sql, params } = lastCall(query);
    expect(params).toEqual([START, END, 'COMPLETED', ['ACTIVE', 'ARCHIVED']]);
    expect(sql).toContain('e."createdAt" >= $1');
    expect(sql).toContain('e."createdAt" < $2');
    expect(sql).toContain(TEST_ORGS);
    expect(sql).toContain('ttu.id = e."userId"');
    expect(sql).not.toContain(SCOPE);
  });

  it('narrows by the learner’s org, bound as $5', async () => {
    const { query, repository } = build();
    await repository.getFunnelEnrollments(START, END, TENANT);
    const { sql, params } = lastCall(query);
    expect(params[4]).toBe(TENANT);
    expect(sql).toContain(SCOPE);
    expect(sql).toContain('stu.id = e."userId"');
    expect(sql).toContain('st.id::text = $5 OR st.code = $5');
    expect(sql).not.toContain(TENANT);
  });

  it('drops soft-deleted enrolments, courses and progress rows', async () => {
    const { query, repository } = build();
    await repository.getFunnelEnrollments(START, END);
    const { sql } = lastCall(query);
    expect(sql).toContain('e."deletedAt" IS NULL');
    expect(sql).toContain('t."deletedAt" IS NULL');
    expect(sql).toContain('p."deletedAt" IS NULL');
  });

  it('uses the shared course-usage definitions for halfway and days to finish', async () => {
    const { query, repository } = build();
    await repository.getFunnelEnrollments(START, END);
    const { sql } = lastCall(query);
    expect(sql).toContain(
      't."totalItems" > 0 AND e."completedItems"::float / t."totalItems" >= 0.5',
    );
    expect(sql).toContain(
      'EXTRACT(EPOCH FROM (e."completedAt" - e."startedAt")) / 86400.0',
    );
  });
});

describe('CurriculumAnalyticsRepository quiz reads', () => {
  it('reads attempts for learners whose first attempt is in the window, scoped and live', async () => {
    const { query, repository } = build();
    await repository.getQuizAttempts(START, END, TENANT);
    const { sql, params } = lastCall(query);
    expect(params).toEqual([START, END, 'QUIZ', TENANT]);
    expect(sql).toContain('f."attemptNumber" = 1');
    expect(sql).toContain('f."submittedAt" >= $1');
    expect(sql).toContain('q."deletedAt" IS NULL');
    expect(sql).toContain('f."deletedAt" IS NULL');
    expect(sql).toContain('i."deletedAt" IS NULL');
    expect(sql).toContain('t."deletedAt" IS NULL');
    expect(sql).toContain(TEST_ORGS);
    expect(sql).toContain('st.id::text = $4 OR st.code = $4');
    expect(sql).not.toContain(TENANT);
  });

  it('selects grading flags only — never answers or grader feedback', async () => {
    const { query, repository } = build();
    await repository.getQuizAttempts(START, END);
    const { sql, params } = lastCall(query);
    expect(params).toEqual([START, END, 'QUIZ']);
    expect(sql).not.toContain(SCOPE);
    expect(sql).not.toContain('answers');
    expect(sql).not.toContain('feedback');
    expect(sql).not.toContain("'llm'");
    expect(sql).toContain("'questionId', g->>'questionId'");
  });

  it('reduces quiz questions to id, type and position', async () => {
    const { query, repository } = build();
    await repository.getQuizItems();
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['QUIZ']);
    expect(sql).not.toContain('prompt');
    expect(sql).not.toContain('options');
    expect(sql).toContain("'type', x.q->>'type'");
    expect(sql).toContain('i."deletedAt" IS NULL');
  });

  it('maps rows without carrying anything but ids and flags', async () => {
    const { query, repository } = build();
    query.mockResolvedValueOnce([
      {
        attempt_id: 'a1',
        item_id: 'i1',
        user_id: '7',
        attempt_number: 1,
        submitted_at: '2026-01-05T00:00:00Z',
        score_pct: '75',
        passed: true,
        grading: [{ questionId: 'q1', correct: false, graded: true }],
      },
    ]);
    const [row] = await repository.getQuizAttempts(START, END);
    expect(row).toEqual({
      attemptId: 'a1',
      trackItemId: 'i1',
      userId: 7,
      attemptNumber: 1,
      submittedAt: new Date('2026-01-05T00:00:00Z'),
      scorePct: 75,
      passed: true,
      grading: [{ questionId: 'q1', correct: false, graded: true }],
    });
  });
});

describe('CurriculumAnalyticsRepository roleplay gate reads', () => {
  it('reads progress with countable linked sessions, scoped by the learner, live rows only', async () => {
    const { query, repository } = build();
    await repository.getGateProgress(TENANT);
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['ROLEPLAY', 'ENDED', 'COMPLETED', TENANT]);
    expect(sql).toContain('s."trackItemProgressId" = p.id');
    expect(sql).toContain(`s."roomId" NOT LIKE 'preview-%'`);
    expect(sql).toContain('p."deletedAt" IS NULL');
    expect(sql).toContain('e."deletedAt" IS NULL');
    expect(sql).toContain('i."deletedAt" IS NULL');
    expect(sql).toContain(
      "jsonb_typeof(i.\"completionCriteria\"->'minScore') = 'number'",
    );
    expect(sql).toContain(TEST_ORGS);
    expect(sql).toContain('st.id::text = $4 OR st.code = $4');
    expect(sql).not.toContain(TENANT);
  });

  it('reads every non-test org with no tenant', async () => {
    const { query, repository } = build();
    await repository.getGateProgress();
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['ROLEPLAY', 'ENDED', 'COMPLETED']);
    expect(sql).not.toContain(SCOPE);
    expect(sql).toContain(TEST_ORGS);
  });

  it('reads gated items with a numeric minScore from live courses', async () => {
    const { query, repository } = build();
    query.mockResolvedValueOnce([
      {
        item_id: 'i1',
        title: 'Roleplay',
        track_id: 't1',
        track_title: 'Course',
        scenario_id: '12',
        min_score: '40',
      },
    ]);
    const rows = await repository.getGatedRoleplayItems();
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['ROLEPLAY']);
    expect(sql).toContain('t."deletedAt" IS NULL');
    expect(rows[0]).toMatchObject({ scenarioId: 12, minScore: 40 });
  });
});

describe('CourseImpactAnalyticsRepository.getFreePracticeCuts', () => {
  it('reads only learners with no live enrolment, pinned and test orgs out', async () => {
    const { query, courseImpact } = build();
    await courseImpact.getFreePracticeCuts('v1');
    const { sql, params } = lastCall(query);
    expect(params).toEqual(['v1']);
    expect(sql).toContain('a."rubricVersion" = $1');
    expect(sql).toContain("a.status = 'SCORED'");
    expect(sql).toContain('NOT EXISTS (');
    expect(sql).toContain('fe."userId" = c."userId"');
    expect(sql).toContain('fe."deletedAt" IS NULL');
    // Both the learner's org and the slice's own tenant keep test orgs out.
    expect(sql).toContain('ttu.id = c."userId"');
    expect(sql).toContain('(c."tenant_id")::text');
    expect(sql).not.toContain(SCOPE);
  });

  it('narrows by the learner’s org, bound as $2, like getScoredCuts', async () => {
    const { query, courseImpact } = build();
    await courseImpact.getFreePracticeCuts('v1', TENANT);
    const free = lastCall(query);
    await courseImpact.getScoredCuts('v1', TENANT);
    const enrolled = lastCall(query);
    for (const { sql, params } of [free, enrolled]) {
      expect(params).toEqual(['v1', TENANT]);
      expect(sql).toContain('st.id::text = $2 OR st.code = $2');
      expect(sql).not.toContain(TENANT);
    }
    expect(free.sql).toContain('stu.id = c."userId"');
    expect(enrolled.sql).toContain('stu.id = e."userId"');
  });
});
