import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { SelfEfficacyAnswer } from '../util/self-efficacy.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * Reads `learner_self_assessments` (src/foundational-skills — the learner
 * self-efficacy instrument) for GET /v1/analytics/foundational-skills/
 * self-efficacy. The scored cuts it is set against come from
 * `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts` (rubric-pinned),
 * so the judge side has ONE definition across the Helping skills charts.
 *
 * Pinned to one instrument version, as the cuts are to one rubric version: a
 * reworded or rescaled instrument is a different question, and answers to two
 * questions are never compared. Test organisations are dropped by the
 * answer's own tenant (the learner's org when they answered); `tenantId`
 * narrows by the same column, the id always a bound parameter.
 */
@Injectable()
export class SelfEfficacyAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Every answer (dismissals included) under `instrumentVersion`, oldest first per learner. */
  async getAnswers(
    instrumentVersion: string,
    tenantId?: string,
  ): Promise<SelfEfficacyAnswer[]> {
    const tenantPredicate = tenantId
      ? `\n         AND ${scopeToTenant('x."tenant_id"', '$2')}`
      : '';
    const rows = await this.dataSource.query(
      `
      SELECT x."userId" AS user_id, x."trigger" AS trigger,
             x."answeredAt" AS answered_at, x.responses AS responses
        FROM learner_self_assessments x
       WHERE x."instrumentVersion" = $1
         AND ${excludeTestTenants('x."tenant_id"')}${tenantPredicate}
       ORDER BY x."userId", x."answeredAt", x.id
      `,
      tenantId ? [instrumentVersion, tenantId] : [instrumentVersion],
    );
    return rows.map((r: any) => ({
      userId: Number(r.user_id),
      trigger: String(r.trigger),
      answeredAt: new Date(r.answered_at),
      responses:
        r.responses && typeof r.responses === 'object' ? r.responses : {},
    }));
  }
}
