import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { FeedbackSkillLinkStatus } from 'src/foundational-skills/enum/feedback-skill-link.enum';
import { StoredFeedbackSkillItem } from 'src/foundational-skills/entity/session-feedback-skill-link.entity';
import { feedbackMappingPopulationSql } from 'src/foundational-skills/util/feedback-skill-mapping-sql.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { UptakeCut } from '../util/feedback-uptake.util';

/** A mapped session as the read needs it: no debrief text, only skill keys. */
export interface FeedbackUptakeSessionRow {
  sessionId: string;
  userId: number;
  endedAt: Date;
  items: StoredFeedbackSkillItem[];
}

export interface FeedbackUptakeCoverageRow {
  debriefed: number;
  mapped: number;
  skipped: number;
  failed: number;
  pending: number;
}

/**
 * Reads what the feedback-uptake chart compares: mapped debriefs
 * (`session_feedback_skill_links`, written by src/foundational-skills) and the
 * scored helping-skills cuts of the same learners.
 *
 * Every query drops test organisations by the row's own tenant, and the org
 * filter narrows by the row's own tenant too — the session's for links, the
 * cut's for cuts — with the id always a bound parameter.
 */
@Injectable()
export class FeedbackUptakeAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** MAPPED sessions under `mapperVersion`, per learner in the order they ended. */
  async getMappedSessions(
    mapperVersion: string,
    tenantId?: string,
  ): Promise<FeedbackUptakeSessionRow[]> {
    const scope = tenantId
      ? `\n         AND ${scopeToTenant('l."tenant_id"', '$2')}`
      : '';
    const rows = await this.dataSource.query(
      `
      SELECT l."scenarioSessionId" AS session_id, l."userId" AS user_id,
             l."sessionEndedAt" AS ended_at, l.items
        FROM session_feedback_skill_links l
       WHERE l."mapperVersion" = $1
         AND l.status = '${FeedbackSkillLinkStatus.MAPPED}'
         AND ${excludeTestTenants('l."tenant_id"')}${scope}
       ORDER BY l."userId", l."sessionEndedAt", l."scenarioSessionId"
      `,
      tenantId ? [mapperVersion, tenantId] : [mapperVersion],
    );
    return rows.map((r: any) => ({
      sessionId: String(r.session_id),
      userId: Number(r.user_id),
      endedAt: new Date(r.ended_at),
      items: Array.isArray(r.items) ? r.items : [],
    }));
  }

  /**
   * Every scored cut (pinned rubric, SCORED, composite present) of the
   * learners with a mapped session, oldest first — with when the cut's first
   * session ended, which the "after" side of the pairing rule needs.
   */
  async getScoredCuts(
    rubricVersion: string,
    mapperVersion: string,
    tenantId?: string,
  ): Promise<UptakeCut[]> {
    const scope = tenantId
      ? `\n         AND ${scopeToTenant('c."tenant_id"', '$3')}`
      : '';
    const rows = await this.dataSource.query(
      `
      SELECT c."userId" AS user_id, c."cutIndex" AS cut_index,
             c."closedSessionEndedAt" AS closed_at,
             fs."endedAt" AS first_ended_at,
             a."skillLevels" AS levels
        FROM foundational_skill_cuts c
        JOIN foundational_skill_assessments a ON a."cutId" = c.id
        LEFT JOIN scenario_sessions fs ON fs.id = c."startSessionId"
       WHERE a."rubricVersion" = $1
         AND a.status = 'SCORED'
         AND a."compositeScore" IS NOT NULL
         AND ${excludeTestTenants('c."tenant_id"')}
         AND c."userId" IN (
               SELECT l."userId" FROM session_feedback_skill_links l
                WHERE l."mapperVersion" = $2
                  AND l.status = '${FeedbackSkillLinkStatus.MAPPED}'
             )${scope}
       ORDER BY c."userId", c."closedSessionEndedAt", c."cutIndex"
      `,
      tenantId
        ? [rubricVersion, mapperVersion, tenantId]
        : [rubricVersion, mapperVersion],
    );
    return rows.map((r: any) => ({
      userId: Number(r.user_id),
      cutIndex: Number(r.cut_index),
      closedAt: new Date(r.closed_at),
      firstEndedAt: r.first_ended_at ? new Date(r.first_ended_at) : null,
      levels: (r.levels ?? {}) as Record<string, number>,
    }));
  }

  /**
   * The mapping's population in scope and where each session stands under
   * `mapperVersion`. Same predicate as the scheduler's queue
   * (`feedbackMappingPopulationSql`), so "pending" here is exactly what the
   * scheduler would still pick up.
   */
  async getCoverage(
    mapperVersion: string,
    rubricVersion: string,
    tenantId?: string,
  ): Promise<FeedbackUptakeCoverageRow> {
    const scope = tenantId
      ? `\n         AND ${scopeToTenant('s."tenant_id"', '$3')}`
      : '';
    const [row] = await this.dataSource.query(
      `
      SELECT COUNT(*)::int AS debriefed,
             COUNT(*) FILTER (WHERE l.status = '${FeedbackSkillLinkStatus.MAPPED}')::int AS mapped,
             COUNT(*) FILTER (WHERE l.status = '${FeedbackSkillLinkStatus.SKIPPED}')::int AS skipped,
             COUNT(*) FILTER (WHERE l.status = '${FeedbackSkillLinkStatus.FAILED}')::int AS failed,
             COUNT(*) FILTER (WHERE l.id IS NULL)::int AS pending
        FROM scenario_sessions s
        JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
        LEFT JOIN session_feedback_skill_links l
          ON l."scenarioSessionId" = s.id AND l."mapperVersion" = $1
       WHERE ${feedbackMappingPopulationSql('s', 'd', '$2')}${scope}
      `,
      tenantId
        ? [mapperVersion, rubricVersion, tenantId]
        : [mapperVersion, rubricVersion],
    );
    return {
      debriefed: Number(row?.debriefed ?? 0),
      mapped: Number(row?.mapped ?? 0),
      skipped: Number(row?.skipped ?? 0),
      failed: Number(row?.failed ?? 0),
      pending: Number(row?.pending ?? 0),
    };
  }
}
