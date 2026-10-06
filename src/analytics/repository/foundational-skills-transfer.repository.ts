import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { FhsAssessmentStatus } from 'src/foundational-skills/enum/foundational-skills.enum';
import { TransferCutRow } from '../util/foundational-skills-transfer.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * Reads behind "Transfer to a new scenario" (EFF-14, AAQ-220).
 *
 * One row per SEALED foundational-skills cut — scored or not — with the
 * scenario of every session it touches, in consumption order. Unscored cuts
 * come back too (with `score` null) because a scenario practised in a cut that
 * failed scoring has still been PLAYED: dropping those cuts would let a
 * scenario the learner has met before read as "new". Only scored cuts are ever
 * paired.
 *
 * Same ruler and scope as the rest of the Helping skills tab: the composite is
 * pinned to one rubric version (`SCORED`, non-null composite), test
 * organisations are excluded by the cut's tenant, and an org filter narrows by
 * that tenant with the id as a BOUND parameter.
 */
@Injectable()
export class FoundationalSkillsTransferRepository {
  constructor(private readonly dataSource: DataSource) {}

  async getCutScenarios(
    rubricVersion: string,
    tenantId?: string,
  ): Promise<TransferCutRow[]> {
    const tenantPredicate = tenantId
      ? `\n         AND ${scopeToTenant('c."tenant_id"', '$2')}`
      : '';
    const rows = await this.dataSource.query(
      `
      WITH cuts AS (
        SELECT c.id, c."userId" AS user_id, c."cutIndex" AS cut,
               c."sessionIds" AS session_ids,
               a."compositeScore"::float AS score
          FROM foundational_skill_cuts c
          LEFT JOIN foundational_skill_assessments a
            ON a."cutId" = c.id
           AND a."rubricVersion" = $1
           AND a.status = '${FhsAssessmentStatus.SCORED}'
           AND a."compositeScore" IS NOT NULL
         WHERE ${excludeTestTenants('c."tenant_id"')}${tenantPredicate}
      )
      SELECT cu.user_id, cu.cut, cu.score,
             COALESCE(
               jsonb_agg(
                 jsonb_build_object(
                   'sessionId', x.session_id::text,
                   'scenarioId', ss."scenarioId",
                   'difficulty', sc."difficultyLevel"
                 ) ORDER BY x.ord
               ) FILTER (WHERE x.session_id IS NOT NULL),
               '[]'::jsonb
             ) AS sessions
        FROM cuts cu
        LEFT JOIN LATERAL unnest(cu.session_ids) WITH ORDINALITY
          AS x(session_id, ord) ON true
        LEFT JOIN scenario_sessions ss ON ss.id = x.session_id
        LEFT JOIN scenarios sc ON sc.id = ss."scenarioId"
       GROUP BY cu.id, cu.user_id, cu.cut, cu.score
       ORDER BY cu.user_id, cu.cut
      `,
      tenantId ? [rubricVersion, tenantId] : [rubricVersion],
    );
    return rows.map((r: any) => ({
      userId: Number(r.user_id),
      cut: Number(r.cut),
      score: r.score === null || r.score === undefined ? null : Number(r.score),
      sessions: (Array.isArray(r.sessions) ? r.sessions : []).map((s: any) => ({
        sessionId: String(s.sessionId),
        scenarioId:
          s.scenarioId === null || s.scenarioId === undefined
            ? null
            : Number(s.scenarioId),
        difficulty: (s.difficulty as string | null) ?? null,
      })),
    }));
  }
}
