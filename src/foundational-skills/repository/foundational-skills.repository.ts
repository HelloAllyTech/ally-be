import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { countableSessionPredicate } from 'src/analytics/util/session-eligibility.util';
import { excludeTestTenants } from 'src/analytics/util/test-tenant.util';
import { FHS_SESSION_SETTLE_MINUTES } from '../constants/helping-skills-rubric.constants';
import { FhsAssessmentStatus } from '../enum/foundational-skills.enum';
import { StoredSkillVerdict } from '../entity/foundational-skill-assessment.entity';
import { PlannedCut, TranscriptTurn } from '../util/transcript-window.util';

/** `scenario_session_messages.senderId` of the AI character. */
const AI_SENDER_ID = -1;

/**
 * SQL twin of JS `String.prototype.trim()` as {@link loadTurns} applies it:
 * whitespace plus NBSP and BOM off both ends. The readiness count and the
 * cutter must agree character for character.
 */
const TRIM_SQL = (column: string): string =>
  `regexp_replace(COALESCE(${column}, ''), '^[[:space:]\u00a0\ufeff]+|[[:space:]\u00a0\ufeff]+$', '', 'g')`;

/**
 * Which sessions feed the measure: real, completed learner practice.
 *
 * - completed, and settled for `FHS_SESSION_SETTLE_MINUTES` (late turns and
 *   timestamp rewrites land after the end signal, and cuts are append-only);
 * - countable (no preview or seed rooms) and not an AI-vs-AI test run;
 * - not in a test organisation.
 */
function eligibleSession(alias: string): string {
  return [
    `${alias}.status = 'ENDED'`,
    `${alias}."eventStatus" = 'COMPLETED'`,
    `${alias}."endedAt" IS NOT NULL`,
    `${alias}."endedAt" < now() - make_interval(mins => ${FHS_SESSION_SETTLE_MINUTES})`,
    `${alias}."counselorId" IS NOT NULL`,
    countableSessionPredicate(alias),
    `COALESCE((${alias}.metadata->>'v2vTest')::boolean, false) = false`,
    excludeTestTenants(`${alias}."tenant_id"`),
  ].join(' AND ');
}

/** A session no cut of its learner has touched yet. */
function unconsumed(alias: string): string {
  return (
    `NOT EXISTS (SELECT 1 FROM foundational_skill_cuts fc ` +
    `WHERE fc."userId" = ${alias}."counselorId" AND ${alias}.id = ANY(fc."sessionIds"))`
  );
}

export interface LastCut {
  cutIndex: number;
  endSessionId: string;
  endMessageId: number;
  endsMidSession: boolean;
}

export interface PendingSession {
  sessionId: string;
  endedAt: Date;
  tenantId: string | null;
}

export interface CutToScore {
  cutId: string;
  userId: number;
  cutIndex: number;
  sessionIds: string[];
  startSessionId: string;
  startMessageId: number;
  endSessionId: string;
  endMessageId: number;
  attempts: number;
}

export interface AssessmentWrite {
  cutId: string;
  rubricVersion: string;
  status: FhsAssessmentStatus;
  model: string | null;
  compositeScore: number | null;
  hasUnhelpfulBehaviour: boolean | null;
  skillLevels: Record<string, number>;
  verdicts: StoredSkillVerdict[];
  droppedTicks: number;
  promptTokens: number | null;
  completionTokens: number | null;
  error: string | null;
}

@Injectable()
export class FoundationalSkillsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Learners who have enough uncut speech to close at least one more cut.
   *
   * Filtering on the threshold here, not just "has an uncut session", matters:
   * a learner sitting at 3,000 characters would otherwise be re-read on every
   * tick, and with a LIMIT they would crowd out learners who can actually close
   * a cut. So the count must be the one the cutter will make — the same rules as
   * {@link loadTurns} applied in SQL: character fillers and interim replies
   * dropped, content trimmed (`TRIM_SQL`), empty lines dropped, and an exact
   * repeat of the previous kept line by the same speaker dropped (a redelivered
   * SQS message). Counting more than the cutter would select a learner forever
   * without ever sealing a cut.
   *
   * The carried tail of a cut that closed mid-session counts too: the kept
   * lines of that session after the cut's last message. The end row is found
   * with a join, not a correlated subquery — the subquery form rescans the
   * whole carry set per row and goes quadratic with learners.
   */
  async findLearnersReadyToCut(
    threshold: number,
    limit: number,
  ): Promise<number[]> {
    const rows: { user_id: number }[] = await this.dataSource.query(
      `
      WITH pending AS (
        SELECT s."counselorId" AS user_id, s.id AS session_id, s."endedAt" AS ended_at
          FROM scenario_sessions s
         WHERE ${eligibleSession('s')} AND ${unconsumed('s')}
      ),
      last_cut AS (
        SELECT DISTINCT ON (c."userId")
               c."userId" AS user_id, c."endSessionId" AS session_id,
               c."endMessageId" AS message_id, c."endsMidSession" AS mid
          FROM foundational_skill_cuts c
         WHERE c."userId" IN (SELECT user_id FROM pending)
         ORDER BY c."userId", c."cutIndex" DESC
      ),
      sources AS (
        SELECT user_id, session_id, NULL::int AS after_message FROM pending
        UNION ALL
        SELECT user_id, session_id, message_id FROM last_cut WHERE mid
      ),
      trimmed AS (
        SELECT src.user_id, src.session_id, src.after_message, m.id,
               (m."senderId" <> ${AI_SENDER_ID}) AS helper,
               ${TRIM_SQL('m.content')} AS text,
               COALESCE(m."startSeconds", 0) AS t
          FROM sources src
          JOIN scenario_session_messages m ON m."scenarioSessionId" = src.session_id
         WHERE NOT (m."senderId" = ${AI_SENDER_ID}
                    AND COALESCE(m.metadata->>'utteranceKind', '') IN ('filler', 'interim'))
      ),
      kept AS (
        SELECT k.*,
               ROW_NUMBER() OVER w AS rn,
               LAG(k.helper) OVER w AS prev_helper,
               LAG(k.text) OVER w AS prev_text
          FROM trimmed k
         WHERE k.text <> ''
        WINDOW w AS (PARTITION BY k.user_id, k.session_id ORDER BY k.t, k.id)
      ),
      carry_end AS (
        SELECT user_id, session_id, rn AS end_rn
          FROM kept
         WHERE after_message IS NOT NULL AND id = after_message
      ),
      learner_chars AS (
        SELECT k.user_id, SUM(char_length(k.text)) AS chars
          FROM kept k
          LEFT JOIN carry_end ce
            ON ce.user_id = k.user_id AND ce.session_id = k.session_id
         WHERE k.helper
           AND NOT COALESCE(k.prev_helper AND k.prev_text = k.text, false)
           AND (k.after_message IS NULL OR k.rn > ce.end_rn)
         GROUP BY k.user_id
      ),
      oldest AS (
        SELECT user_id, MIN(ended_at) AS oldest FROM pending GROUP BY user_id
      )
      SELECT o.user_id
        FROM oldest o
        JOIN learner_chars lc ON lc.user_id = o.user_id
       WHERE lc.chars >= $1
       ORDER BY o.oldest
       LIMIT $2
      `,
      [threshold, limit],
    );
    return rows.map((r) => Number(r.user_id));
  }

  async findLastCut(userId: number): Promise<LastCut | null> {
    const rows = await this.dataSource.query(
      `SELECT "cutIndex", "endSessionId", "endMessageId", "endsMidSession"
         FROM foundational_skill_cuts
        WHERE "userId" = $1
        ORDER BY "cutIndex" DESC
        LIMIT 1`,
      [userId],
    );
    if (rows.length === 0) return null;
    return {
      cutIndex: Number(rows[0].cutIndex),
      endSessionId: rows[0].endSessionId,
      endMessageId: Number(rows[0].endMessageId),
      endsMidSession: rows[0].endsMidSession === true,
    };
  }

  /** The learner's uncut eligible sessions, in the order they ended. */
  async findPendingSessions(userId: number): Promise<PendingSession[]> {
    const rows: { id: string; ended_at: Date; tenant_id: string | null }[] =
      await this.dataSource.query(
        `SELECT s.id, s."endedAt" AS ended_at, s.tenant_id
           FROM scenario_sessions s
          WHERE s."counselorId" = $1 AND ${eligibleSession('s')} AND ${unconsumed('s')}
          ORDER BY s."endedAt", s.id`,
        [userId],
      );
    return rows.map((r) => ({
      sessionId: r.id,
      endedAt: new Date(r.ended_at),
      tenantId: r.tenant_id,
    }));
  }

  /** Session header facts for sessions already known to exist (e.g. a carry). */
  async findSessionHeaders(sessionIds: string[]): Promise<PendingSession[]> {
    if (sessionIds.length === 0) return [];
    const rows: {
      id: string;
      ended_at: Date | null;
      tenant_id: string | null;
    }[] = await this.dataSource.query(
      `SELECT id, "endedAt" AS ended_at, tenant_id
           FROM scenario_sessions WHERE id = ANY($1::uuid[])`,
      [sessionIds],
    );
    return rows.map((r) => ({
      sessionId: r.id,
      endedAt: new Date(r.ended_at ?? 0),
      tenantId: r.tenant_id,
    }));
  }

  /**
   * Each session's turns in spoken order, the way every judge on the platform
   * reads them (`ORDER BY COALESCE("startSeconds", 0), id`).
   *
   * Dropped: fillers and interim replies (latency masking, stored as character
   * lines), empty lines, and an exact repeat of the same speaker's previous line
   * — messages arrive over SQS with no dedup key, and a redelivered turn would
   * otherwise count twice towards the learner's characters.
   */
  async loadTurns(
    sessionIds: string[],
  ): Promise<Map<string, TranscriptTurn[]>> {
    const result = new Map<string, TranscriptTurn[]>(
      sessionIds.map((id) => [id, []]),
    );
    if (sessionIds.length === 0) return result;

    const rows: {
      id: number;
      session_id: string;
      sender_id: number;
      content: string | null;
      utterance_kind: string | null;
    }[] = await this.dataSource.query(
      `SELECT m.id, m."scenarioSessionId" AS session_id, m."senderId" AS sender_id,
              m.content, m.metadata->>'utteranceKind' AS utterance_kind
         FROM scenario_session_messages m
        WHERE m."scenarioSessionId" = ANY($1::uuid[])
        ORDER BY m."scenarioSessionId", COALESCE(m."startSeconds", 0), m.id`,
      [sessionIds],
    );

    for (const row of rows) {
      const speaker =
        Number(row.sender_id) === AI_SENDER_ID ? 'client' : 'helper';
      if (
        speaker === 'client' &&
        (row.utterance_kind === 'filler' || row.utterance_kind === 'interim')
      ) {
        continue;
      }
      const text = (row.content ?? '').trim();
      if (!text) continue;
      const turns = result.get(row.session_id);
      if (!turns) continue;
      const previous = turns[turns.length - 1];
      if (previous && previous.speaker === speaker && previous.text === text) {
        continue;
      }
      turns.push({ messageId: Number(row.id), speaker, text });
    }
    return result;
  }

  /**
   * Persist freshly sealed cuts. `ON CONFLICT DO NOTHING` on (userId, cutIndex)
   * makes a second writer harmless: the scheduler bucket already holds an
   * advisory lock, but a manual run could overlap a tick.
   */
  async insertCuts(
    userId: number,
    firstIndex: number,
    cuts: readonly PlannedCut[],
  ): Promise<number> {
    let inserted = 0;
    for (const [offset, cut] of cuts.entries()) {
      const rows = await this.dataSource.query(
        `INSERT INTO foundational_skill_cuts
           ("userId", "cutIndex", tenant_id, "sessionIds", "startSessionId", "startMessageId",
            "endSessionId", "endMessageId", "startsMidSession", "endsMidSession",
            "learnerChars", "totalChars", "closedSessionEndedAt")
         VALUES ($1, $2, $3, $4::uuid[], $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT ("userId", "cutIndex") DO NOTHING
         RETURNING id`,
        [
          userId,
          firstIndex + offset,
          cut.tenantId,
          cut.sessionIds,
          cut.startSessionId,
          cut.startMessageId,
          cut.endSessionId,
          cut.endMessageId,
          cut.startsMidSession,
          cut.endsMidSession,
          cut.learnerChars,
          cut.totalChars,
          cut.closedSessionEndedAt,
        ],
      );
      if (rows.length === 0) break; // someone else sealed it; stop, re-plan next tick
      inserted += 1;
    }
    return inserted;
  }

  /** Cuts with no SCORED assessment under `rubricVersion`, oldest first. */
  async findCutsToScore(
    rubricVersion: string,
    maxAttempts: number,
    limit: number,
  ): Promise<CutToScore[]> {
    const rows = await this.dataSource.query(
      `SELECT c.id, c."userId", c."cutIndex", c."sessionIds", c."startSessionId",
              c."startMessageId", c."endSessionId", c."endMessageId",
              COALESCE(a.attempts, 0) AS attempts
         FROM foundational_skill_cuts c
         LEFT JOIN foundational_skill_assessments a
           ON a."cutId" = c.id AND a."rubricVersion" = $1
        WHERE a.id IS NULL
           OR (a.status = '${FhsAssessmentStatus.FAILED}' AND a.attempts < $2
               AND a."updatedAt" < now() - interval '1 hour')
        ORDER BY c."cutIndex", c."createdAt"
        LIMIT $3`,
      [rubricVersion, maxAttempts, limit],
    );
    return rows.map((r: any) => ({
      cutId: r.id,
      userId: Number(r.userId),
      cutIndex: Number(r.cutIndex),
      sessionIds: r.sessionIds,
      startSessionId: r.startSessionId,
      startMessageId: Number(r.startMessageId),
      endSessionId: r.endSessionId,
      endMessageId: Number(r.endMessageId),
      attempts: Number(r.attempts),
    }));
  }

  /** Insert or overwrite the (cut, version) row; a FAILED row counts attempts. */
  async upsertAssessment(write: AssessmentWrite): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO foundational_skill_assessments
         ("cutId", "rubricVersion", status, attempts, model, "compositeScore",
          "hasUnhelpfulBehaviour", "skillLevels", verdicts, "droppedTicks",
          "promptTokens", "completionTokens", error, "scoredAt")
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13)
       ON CONFLICT ("cutId", "rubricVersion") DO UPDATE SET
         status = EXCLUDED.status,
         attempts = foundational_skill_assessments.attempts + 1,
         model = EXCLUDED.model,
         "compositeScore" = EXCLUDED."compositeScore",
         "hasUnhelpfulBehaviour" = EXCLUDED."hasUnhelpfulBehaviour",
         "skillLevels" = EXCLUDED."skillLevels",
         verdicts = EXCLUDED.verdicts,
         "droppedTicks" = EXCLUDED."droppedTicks",
         "promptTokens" = EXCLUDED."promptTokens",
         "completionTokens" = EXCLUDED."completionTokens",
         error = EXCLUDED.error,
         "scoredAt" = EXCLUDED."scoredAt",
         "updatedAt" = now()`,
      [
        write.cutId,
        write.rubricVersion,
        write.status,
        write.model,
        write.compositeScore,
        write.hasUnhelpfulBehaviour,
        JSON.stringify(write.skillLevels),
        JSON.stringify(write.verdicts),
        write.droppedTicks,
        write.promptTokens,
        write.completionTokens,
        write.error,
        write.status === FhsAssessmentStatus.SCORED ? new Date() : null,
      ],
    );
  }
}
