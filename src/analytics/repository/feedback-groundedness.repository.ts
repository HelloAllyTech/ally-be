import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { excludeTestTenants } from '../util/test-tenant.util';

/** A session with feedback worth judging. */
export interface GroundednessSessionRow {
  id: string;
  tenant_id: string;
  scenario_id: number | null;
  scenario_version_id: string | null;
  language: string;
  llm_model: string | null;
  occurred_at: Date;
}

/** One feedback claim, as sent to the judge. */
export interface FeedbackClaim {
  claim_index: number;
  kind: 'positive' | 'improvement';
  text: string;
}

export interface TranscriptTurn {
  role: 'client' | 'counselor';
  text: string;
  turn_index?: number;
}

/** What the judge returns per claim. */
export interface ClaimJudgment {
  claim_index: number;
  kind: string;
  verdict: string;
  quotes_transcript?: boolean | null;
  quote_is_accurate?: boolean | null;
  reasoning?: string | null;
}

/**
 * Data access for the feedback-groundedness judge.
 *
 * Same division as the drift and language judges: ally-be owns the data and
 * does all selection, assembly and persistence; ally-ai is a stateless judge
 * that never touches this database.
 */
@Injectable()
export class FeedbackGroundednessRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The rubric from prompt management; null falls back to ally-ai's inline default. */
  async fetchRubric(): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT pv.prompt
         FROM prompts p
         JOIN prompts_versions pv
           ON pv."promptId" = p.id AND pv.version = p."currentVersion"
        WHERE p."promptCode" = 'feedback_groundedness_rubric'
        LIMIT 1`,
    );
    return rows?.[0]?.prompt ?? null;
  }

  /**
   * Sessions carrying feedback with checkable claims.
   *
   * Requires both a `positives`/`improvements` object AND transcript messages:
   * judging claims against an empty transcript would mark every one
   * unsupported and manufacture a groundedness crisis out of sessions where
   * the agent never joined.
   */
  async selectSessions(opts: {
    sinceDays?: number | null;
    limit?: number | null;
    /**
     * Scope "already judged" to one rubric version, so a re-judge picks up
     * sessions the new rubric has not seen and skips work already done. Makes
     * an interrupted run resumable by simply re-issuing it.
     */
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null;
  }): Promise<GroundednessSessionRow[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };

    let sql = `
      SELECT s.id,
             s.tenant_id AS tenant_id,
             s."scenarioId" AS scenario_id,
             s."scenarioVersionId" AS scenario_version_id,
             COALESCE(l.value, 'en') AS language,
             (SELECT mode() WITHIN GROUP (ORDER BY m."llmModel")
                FROM scenario_session_turn_metrics m
               WHERE m."scenarioSessionId" = s.id
                 AND m."llmModel" IS NOT NULL) AS llm_model,
             COALESCE(d."createdAt", s."createdAt") AS occurred_at
        FROM scenario_sessions s
        JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
        LEFT JOIN languages l
          ON l.id = NULLIF(s.metadata->>'languageId', '')::int
       WHERE s."roomId" NOT LIKE 'preview-%'
         AND s."roomId" NOT LIKE 'seed-room-%'
         AND d.summary->'feedback' ? 'positives'
         AND ${excludeTestTenants('s."tenant_id"')}
         AND EXISTS (
           SELECT 1 FROM scenario_session_messages m
            WHERE m."scenarioSessionId" = s.id)`;

    if (opts.sinceDays != null) {
      sql += ` AND s."createdAt" >= now() - make_interval(days => ${p(
        opts.sinceDays,
      )})`;
    }
    if (opts.unjudgedForVersion) {
      sql += ` AND NOT EXISTS (
                 SELECT 1 FROM feedback_claim_judgment j
                  WHERE j."scenarioSessionId" = s.id
                    AND j."judgeModel" = ${p(
                      opts.unjudgedForVersion.judgeModel,
                    )}
                    AND j."judgePromptVersion" = ${p(
                      opts.unjudgedForVersion.judgePromptVersion,
                    )})`;
    }
    sql += ` ORDER BY s."createdAt" DESC`;
    if (opts.limit) sql += ` LIMIT ${p(opts.limit)}`;
    return this.dataSource.query(sql, params);
  }

  /**
   * The claims to check, flattened from the feedback object.
   *
   * `claim_index` is the position WITHIN its list, so (kind, index) identifies
   * a claim stably — the same key the unique constraint uses. Indexing across
   * the concatenation instead would shift every improvement's id whenever the
   * number of positives changed, and silently repoint stored verdicts.
   */
  async buildClaims(sessionId: string): Promise<FeedbackClaim[]> {
    const rows = await this.dataSource.query(
      `SELECT kind, idx, text FROM (
         SELECT 'positive' AS kind,
                (ord - 1)::int AS idx,
                value AS text
           FROM scenario_session_details d,
                LATERAL jsonb_array_elements_text(
                  d.summary->'feedback'->'positives') WITH ORDINALITY AS t(value, ord)
          WHERE d."scenarioSessionId" = $1
            AND jsonb_typeof(d.summary->'feedback'->'positives') = 'array'
         UNION ALL
         SELECT 'improvement' AS kind,
                (ord - 1)::int AS idx,
                value AS text
           FROM scenario_session_details d,
                LATERAL jsonb_array_elements_text(
                  d.summary->'feedback'->'improvements') WITH ORDINALITY AS t(value, ord)
          WHERE d."scenarioSessionId" = $1
            AND jsonb_typeof(d.summary->'feedback'->'improvements') = 'array'
       ) c
       WHERE length(btrim(c.text)) > 0
       ORDER BY kind, idx`,
      [sessionId],
    );
    return rows.map(
      (r: { kind: string; idx: number; text: string }): FeedbackClaim => ({
        claim_index: Number(r.idx),
        kind: r.kind as 'positive' | 'improvement',
        text: r.text,
      }),
    );
  }

  /**
   * Whole-session transcript. AI turns carry an index; a counsellor turn is
   * plain text. Mirrors the drift judge's builder so both judges read the same
   * conversation the same way.
   */
  async buildTranscript(sessionId: string): Promise<TranscriptTurn[]> {
    const rows = await this.dataSource.query(
      `SELECT "senderId" AS sender_id, content
         FROM scenario_session_messages
        WHERE "scenarioSessionId" = $1
        ORDER BY "createdAt" ASC, id ASC`,
      [sessionId],
    );
    const out: TranscriptTurn[] = [];
    let aiIndex = 0;
    for (const r of rows as Array<{ sender_id: number; content: string }>) {
      const text = (r.content ?? '').trim();
      if (!text) continue;
      if (Number(r.sender_id) === -1) {
        out.push({ role: 'client', text, turn_index: aiIndex });
        aiIndex += 1;
      } else {
        out.push({ role: 'counselor', text });
      }
    }
    return out;
  }

  /**
   * Persist one session's verdicts.
   *
   * Upsert on (session, kind, index, judgeModel, judgePromptVersion): a
   * re-judge under the same version corrects itself in place, while a new
   * rubric version writes alongside rather than over the old one.
   */
  async upsertJudgments(
    session: GroundednessSessionRow,
    claims: FeedbackClaim[],
    judgments: ClaimJudgment[],
    judgeModel: string,
    judgePromptVersion: string,
  ): Promise<void> {
    const textByKey = new Map(
      claims.map((c) => [`${c.kind}:${c.claim_index}`, c.text]),
    );
    for (const j of judgments) {
      const key = `${j.kind}:${j.claim_index}`;
      await this.dataSource.query(
        `INSERT INTO feedback_claim_judgment (
           "tenant_id", "scenarioSessionId", "claimKind", "claimIndex",
           "verdict", "quotesTranscript", "quoteIsAccurate", "claimText",
           "reasoning", "language", "scenarioId", "scenarioVersionId",
           "llmModel", "occurredAt", "judgeModel", "judgePromptVersion"
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
         )
         ON CONFLICT ("scenarioSessionId", "claimKind", "claimIndex",
                      "judgeModel", "judgePromptVersion")
         DO UPDATE SET
           "verdict" = EXCLUDED."verdict",
           "quotesTranscript" = EXCLUDED."quotesTranscript",
           "quoteIsAccurate" = EXCLUDED."quoteIsAccurate",
           "claimText" = EXCLUDED."claimText",
           "reasoning" = EXCLUDED."reasoning",
           "updatedAt" = now()`,
        [
          session.tenant_id,
          session.id,
          j.kind,
          j.claim_index,
          j.verdict,
          j.quotes_transcript ?? null,
          j.quote_is_accurate ?? null,
          textByKey.get(key) ?? null,
          j.reasoning ?? null,
          session.language,
          session.scenario_id,
          session.scenario_version_id,
          session.llm_model,
          session.occurred_at,
          judgeModel,
          judgePromptVersion,
        ],
      );
    }
  }
}
