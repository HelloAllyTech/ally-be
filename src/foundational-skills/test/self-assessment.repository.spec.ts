import { DataSource } from 'typeorm';

import {
  SELF_ASSESSMENT_LOCK_NAMESPACE,
  SelfAssessmentRepository,
} from '../repository/self-assessment.repository';
import { SelfAssessmentTrigger } from '../enum/self-assessment.enum';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  const repository = new SelfAssessmentRepository({
    query,
  } as unknown as DataSource);
  return { query, repository };
};

const call = (query: jest.Mock, i = 0) => ({
  sql: String(query.mock.calls[i][0]),
  params: query.mock.calls[i][1] as unknown[],
});

describe('SelfAssessmentRepository', () => {
  it('counts scored cuts on the pinned rubric, SCORED with a composite', async () => {
    const { query, repository } = build([{ n: 7 }]);
    expect(await repository.countScoredCuts(42, 'fhs-text-v1')).toBe(7);
    const { sql, params } = call(query);
    expect(params).toEqual([42, 'fhs-text-v1', 'SCORED']);
    expect(sql).toContain('a."rubricVersion" = $2');
    expect(sql).toContain('a.status = $3');
    expect(sql).toContain('a."compositeScore" IS NOT NULL');
    expect(sql).not.toContain('closedSessionEndedAt');
  });

  it('counts only cuts closed by a past answer when asked to', async () => {
    const { query, repository } = build([{ n: 3 }]);
    const at = new Date('2026-09-01T00:00:00Z');
    await repository.countScoredCuts(42, 'fhs-text-v1', at);
    const { sql, params } = call(query);
    expect(params).toEqual([42, 'fhs-text-v1', 'SCORED', at]);
    expect(sql).toContain('c."closedSessionEndedAt" <= $4');
  });

  it('reads the latest live course completion after the last answer', async () => {
    const { query, repository } = build([
      { track_id: 'track-1', completed_at: '2026-10-01T00:00:00Z' },
    ]);
    const since = new Date('2026-09-01T00:00:00Z');
    expect(await repository.latestCourseCompletionSince(42, since)).toEqual({
      trackId: 'track-1',
      completedAt: new Date('2026-10-01T00:00:00Z'),
    });
    const { sql, params } = call(query);
    expect(params).toEqual([42, since]);
    expect(sql).toContain('e."completedAt" > $2');
    expect(sql).toContain('e."deletedAt" IS NULL');
    expect(sql).toContain('ORDER BY e."completedAt" DESC');
  });

  it('reads any completion when the learner never answered', async () => {
    const { query, repository } = build([]);
    expect(await repository.latestCourseCompletionSince(42, null)).toBeNull();
    expect(call(query).params).toEqual([42]);
    expect(call(query).sql).not.toContain('$2');
  });

  it('returns null for a learner with no answer', async () => {
    const { repository } = build([]);
    expect(await repository.findLast(42)).toBeNull();
  });

  it('takes a per-learner transaction lock', async () => {
    const { query, repository } = build([]);
    await repository.lockLearner(42, { query });
    expect(call(query)).toEqual({
      sql: 'SELECT pg_advisory_xact_lock($1, $2)',
      params: [SELF_ASSESSMENT_LOCK_NAMESPACE, 42],
    });
  });

  it('inserts the answer as JSON and returns its id', async () => {
    const { query, repository } = build([
      { id: 'row-1', answered_at: '2026-10-05T12:00:00Z' },
    ]);
    const answeredAt = new Date('2026-10-05T12:00:00Z');
    const stored = await repository.insert({
      userId: 42,
      tenantId: 'tenant-a',
      instrumentVersion: 'v1',
      trigger: SelfAssessmentTrigger.CUTS,
      triggerRef: '6',
      responses: { verbal: 7 },
      answeredAt,
    });
    expect(stored).toEqual({ id: 'row-1', answeredAt });
    expect(call(query).params).toEqual([
      'tenant-a',
      42,
      'v1',
      'CUTS',
      '6',
      '{"verbal":7}',
      answeredAt,
    ]);
  });
});
