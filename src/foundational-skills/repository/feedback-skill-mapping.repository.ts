import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FeedbackSkillLinkStatus } from '../enum/feedback-skill-link.enum';
import { StoredFeedbackSkillItem } from '../entity/session-feedback-skill-link.entity';
import { feedbackMappingPopulationSql } from '../util/feedback-skill-mapping-sql.util';

/** A debriefed session that still needs a mapping under the current version. */
export interface SessionToMap {
  sessionId: string;
  userId: number;
  tenantId: string | null;
  endedAt: Date;
  attempts: number;
}

export interface FeedbackSkillLinkWrite {
  sessionId: string;
  userId: number;
  tenantId: string | null;
  sessionEndedAt: Date;
  mapperVersion: string;
  status: FeedbackSkillLinkStatus;
  itemCount: number;
  items: StoredFeedbackSkillItem[];
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Why an attempt failed or was skipped. Never debrief text. */
  error: string | null;
}

/**
 * Writing side of the feedback → skill mapping. The read side is
 * `FeedbackUptakeAnalyticsRepository`, which queries the table directly.
 */
@Injectable()
export class FeedbackSkillMappingRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Debriefed sessions with no result under `mapperVersion`, plus FAILED ones
   * due a retry (hourly back-off, `maxAttempts` cap — the FHS pipeline's
   * rules), oldest first. MAPPED and SKIPPED rows are final.
   *
   * Only sessions that can ever reach the chart:
   *  - FHS-eligible (`fhsEligibleSession`): ended and completed, settled for an
   *    hour, a countable room, not an AI-vs-AI test, not a test organisation;
   *  - a debrief with at least one improvement item;
   *  - a learner with at least one scored cut under `rubricVersion`.
   */
  async findSessionsToMap(
    mapperVersion: string,
    rubricVersion: string,
    maxAttempts: number,
    limit: number,
  ): Promise<SessionToMap[]> {
    const rows = await this.dataSource.query(
      `SELECT s.id AS session_id, s."counselorId" AS user_id, s.tenant_id,
              s."endedAt" AS ended_at, COALESCE(l.attempts, 0) AS attempts
         FROM scenario_sessions s
         JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
         LEFT JOIN session_feedback_skill_links l
           ON l."scenarioSessionId" = s.id AND l."mapperVersion" = $1
        WHERE ${feedbackMappingPopulationSql('s', 'd', '$2')}
          AND (l.id IS NULL
               OR (l.status = '${FeedbackSkillLinkStatus.FAILED}' AND l.attempts < $3
                   AND l."updatedAt" < now() - interval '1 hour'))
        ORDER BY s."endedAt", s.id
        LIMIT $4`,
      [mapperVersion, rubricVersion, maxAttempts, limit],
    );
    return rows.map((r: any) => ({
      sessionId: r.session_id,
      userId: Number(r.user_id),
      tenantId: r.tenant_id ?? null,
      endedAt: new Date(r.ended_at),
      attempts: Number(r.attempts),
    }));
  }

  /**
   * Each session's stored debrief (`summary.feedback`), for the mapper to read
   * in memory. Nothing read here is written anywhere.
   */
  async loadDebriefs(sessionIds: string[]): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    if (sessionIds.length === 0) return result;
    const rows: { session_id: string; feedback: unknown }[] =
      await this.dataSource.query(
        `SELECT d."scenarioSessionId" AS session_id, d.summary->'feedback' AS feedback
           FROM scenario_session_details d
          WHERE d."scenarioSessionId" = ANY($1::uuid[])`,
        [sessionIds],
      );
    for (const row of rows) result.set(row.session_id, row.feedback ?? null);
    return result;
  }

  /** Insert or overwrite the (session, version) row; a retry counts attempts. */
  async upsertLink(write: FeedbackSkillLinkWrite): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO session_feedback_skill_links
         ("scenarioSessionId", "userId", tenant_id, "sessionEndedAt", "mapperVersion",
          status, attempts, "itemCount", items, model, "promptTokens",
          "completionTokens", error, "mappedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8::jsonb, $9, $10, $11, $12, $13)
       ON CONFLICT ("scenarioSessionId", "mapperVersion") DO UPDATE SET
         status = EXCLUDED.status,
         attempts = session_feedback_skill_links.attempts + 1,
         "itemCount" = EXCLUDED."itemCount",
         items = EXCLUDED.items,
         model = EXCLUDED.model,
         "promptTokens" = EXCLUDED."promptTokens",
         "completionTokens" = EXCLUDED."completionTokens",
         error = EXCLUDED.error,
         "mappedAt" = EXCLUDED."mappedAt",
         "updatedAt" = now()`,
      [
        write.sessionId,
        write.userId,
        write.tenantId,
        write.sessionEndedAt,
        write.mapperVersion,
        write.status,
        write.itemCount,
        JSON.stringify(write.items),
        write.model,
        write.promptTokens,
        write.completionTokens,
        write.error,
        write.status === FeedbackSkillLinkStatus.MAPPED ? new Date() : null,
      ],
    );
  }
}
