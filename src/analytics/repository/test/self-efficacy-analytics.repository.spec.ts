import { DataSource } from 'typeorm';

import { SelfEfficacyAnalyticsRepository } from '../self-efficacy-analytics.repository';

/**
 * The self-efficacy read: one instrument version, test orgs dropped by the
 * answer's own tenant, and the org filter narrowing by that same column with
 * the id as a BOUND parameter (never interpolated).
 */
const TENANT = 'b3f1c2d4-0000-4000-8000-000000000001';
const SCOPE = 'EXISTS (SELECT 1 FROM tenants st';

const build = (rows: unknown[] = []) => {
  const query = jest.fn().mockResolvedValue(rows);
  return {
    query,
    repository: new SelfEfficacyAnalyticsRepository({
      query,
    } as unknown as DataSource),
  };
};

describe('SelfEfficacyAnalyticsRepository.getAnswers', () => {
  it('pins the instrument version and drops test orgs', async () => {
    const { query, repository } = build();
    await repository.getAnswers('v1');
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['v1']);
    expect(sql).toContain('x."instrumentVersion" = $1');
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).toContain('(x."tenant_id")::text');
    expect(sql).not.toContain(SCOPE);
  });

  it('narrows to one org by the answer’s tenant, bound as $2', async () => {
    const { query, repository } = build();
    await repository.getAnswers('v1', TENANT);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['v1', TENANT]);
    expect(sql).toContain(SCOPE);
    expect(sql).toContain('st.id::text = $2 OR st.code = $2');
    expect(sql).toContain('"isTestOrganization" = true');
    expect(sql).not.toContain(TENANT);
  });

  it('maps rows, treating a missing responses object as a dismissal', async () => {
    const { repository } = build([
      {
        user_id: '7',
        trigger: 'ONBOARDING',
        answered_at: '2026-09-01T10:00:00Z',
        responses: { verbal: 6 },
      },
      {
        user_id: 8,
        trigger: 'CUTS',
        answered_at: '2026-09-02T10:00:00Z',
        responses: null,
      },
    ]);
    expect(await repository.getAnswers('v1')).toEqual([
      {
        userId: 7,
        trigger: 'ONBOARDING',
        answeredAt: new Date('2026-09-01T10:00:00Z'),
        responses: { verbal: 6 },
      },
      {
        userId: 8,
        trigger: 'CUTS',
        answeredAt: new Date('2026-09-02T10:00:00Z'),
        responses: {},
      },
    ]);
  });
});
