import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { countableSessionPredicate } from '../util/session-eligibility.util';

/** Prompt-management code for the language judge rubric (seeded by migration). */
export const LANGUAGE_JUDGE_PROMPT_CODE = 'language_quality_judge_rubric';

export interface LanguageSessionRow {
  id: string;
  tenant_id: string;
  scenario_id: number | null;
  scenario_version_id: string | null;
  language: string;
  language_label: string | null;
  /** languages.evalConfig — FR19 per-language declarative config. */
  eval_config: Record<string, any> | null;
  persona: string | null;
  prompt_versions: Record<string, unknown> | null;
  occurred_at: Date | null;
  llm_provider: string | null;
  llm_model: string | null;
  engine: string | null;
  register_directive_configured: boolean;
  style_exemplars_configured: boolean;
  allowed_fillers: string[] | null;
  /** scenario_voices row the session used (round-trip TTS resolution). */
  tts_provider: string | null;
  tts_voice_config: Record<string, any> | null;
  voice_id: string | null;
  voice_name: string | null;
}

/** One per-turn judgment as returned by the ally-ai language judge (snake_case). */
export interface LanguageTurnJudgment {
  turn_index: number;
  input_garbled: string; // none | partial | severe
  errors: LanguageErrorAnnotationJson[];
}

export interface LanguageErrorAnnotationJson {
  layer: string;
  dimension: string;
  category: string;
  severity: string;
  evidence_quote: string;
  isolation_basis: string;
  conditioned_out: boolean;
  reasoning: string;
}

export interface LanguageJudgeAiResult {
  per_turn: LanguageTurnJudgment[];
  turns_judged: number;
  dropped_annotations: number;
}

/**
 * Data access for language-quality judging (see language-eval-judge-schema.md).
 * ally-be owns the tables, so the orchestration (select → build transcript →
 * persist) lives here; the Gemini judge itself is a stateless call to ally-ai.
 *
 * Single write path, two read surfaces: these rows are read raw per session by
 * Roleplay Session Logs and aggregated by the analytics dashboard.
 */
/**
 * The session projection both selectors need.
 *
 * Extracted rather than copied: the round-trip top-up reads the SAME session
 * shape as the judging selector, and two hand-maintained copies of a
 * thirty-line projection diverge the first time a column is added to one of
 * them. The `WHERE` differs per caller and is appended by each.
 */
const SESSION_PROJECTION = `
      SELECT s.id,
             s.tenant_id        AS tenant_id,
             s."scenarioId"     AS scenario_id,
             s."scenarioVersionId" AS scenario_version_id,
             COALESCE(l.value, 'en') AS language,
             l.label            AS language_label,
             l."evalConfig"     AS eval_config,
             v.provider         AS tts_provider,
             v.config           AS tts_voice_config,
             NULLIF(s.metadata->>'voiceId', '') AS voice_id,
             v.name             AS voice_name,
             sc.prompt          AS persona,
             sc.engine          AS engine,
             s.metadata->'promptVersions' AS prompt_versions,
             s."createdAt"      AS occurred_at,
             (sc.metadata->'languageCharacteristics'->>(s.metadata->>'languageId'))
               IS NOT NULL AS register_directive_configured,
             (sc.metadata->'linguisticStyleSamples'->(s.metadata->>'languageId'))
               IS NOT NULL AS style_exemplars_configured,
             (SELECT array_agg(f)
                FROM jsonb_array_elements_text(
                  COALESCE(sc.metadata->'allowedFillerWords'
                             ->(s.metadata->>'languageId'), '[]'::jsonb)) f
             ) AS allowed_fillers,
             (SELECT mode() WITHIN GROUP (ORDER BY m."llmProvider")
                FROM scenario_session_turn_metrics m
                WHERE m."scenarioSessionId" = s.id
                  AND m."llmProvider" IS NOT NULL) AS llm_provider,
             (SELECT mode() WITHIN GROUP (ORDER BY m."llmModel")
                FROM scenario_session_turn_metrics m
                WHERE m."scenarioSessionId" = s.id
                  AND m."llmModel" IS NOT NULL) AS llm_model
      FROM scenario_sessions s
      LEFT JOIN languages l
        ON l.id = NULLIF(s.metadata->>'languageId', '')::int
      LEFT JOIN scenario_voices v
        ON v.id::text = NULLIF(s.metadata->>'voiceId', '')
      LEFT JOIN scenarios sc ON sc.id = s."scenarioId"`;

@Injectable()
export class LanguageJudgeRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Current rubric from prompt management; null if absent (judge falls back). */
  async fetchRubric(): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT pv.prompt
         FROM prompts p
         LEFT JOIN prompts_versions pv
           ON p.id = pv."promptId" AND pv.version = p."currentVersion"
        WHERE p."promptCode" = $1`,
      [LANGUAGE_JUDGE_PROMPT_CODE],
    );
    return rows?.[0]?.prompt ?? null;
  }

  /**
   * Sessions to judge. Uses the shared countable-session predicate (preview +
   * seed rooms excluded — see session-eligibility.util). Besides the drift
   * judge's fields this also selects, per session:
   * - engine (SIMULATION | ROLEPLAY_V2) — both are judged; slice dimension
   * - per-language style-config presence flags + allowed fillers from
   *   scenarios.metadata, keyed by the session's languageId — these feed the
   *   judge's persona_specified/persona_unspecified isolation basis
   *   (the prompt-before-model decision rule).
   */
  async selectSessions(opts: {
    sinceDays?: number | null;
    language?: string | null;
    onlyUnjudged?: boolean;
    limit?: number | null;
    /**
     * Scope "already judged" to ONE rubric version — same reasoning as the
     * drift judge's selector: without it a re-judge skips exactly the sessions
     * worth re-judging, because they all carry rows from the old rubric.
     */
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null;
  }): Promise<LanguageSessionRow[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    // A session with no AI turns has nothing for this judge to read. It used to
    // be selected anyway and discarded inside the loop, which was merely
    // wasteful while a run took the whole backlog — the run skipped it and
    // carried on. Once runs are chunked it is fatal: skipping writes no
    // judgment row, so `onlyUnjudged` returns the same sessions next tick and
    // the backfill spins on them forever. Twenty-five such sessions sat at the
    // head of the queue and stalled the language family completely.
    let sql = `${SESSION_PROJECTION}
      WHERE ${countableSessionPredicate('s')}
        AND EXISTS (SELECT 1 FROM scenario_session_messages m
                     WHERE m."scenarioSessionId" = s.id
                       AND m."senderId" = -1)`;
    if (opts.language)
      sql += ` AND COALESCE(l.value, 'en') = ${p(opts.language)}`;
    if (opts.sinceDays != null)
      sql += ` AND s."createdAt" >= now() - make_interval(days => ${p(opts.sinceDays)})`;
    if (opts.onlyUnjudged) {
      if (opts.unjudgedForVersion) {
        sql += ` AND NOT EXISTS (
                   SELECT 1 FROM language_judgment_sessions j
                   WHERE j."scenarioSessionId" = s.id
                     AND j."judgeModel" = ${p(opts.unjudgedForVersion.judgeModel)}
                     AND j."judgePromptVersion" = ${p(
                       opts.unjudgedForVersion.judgePromptVersion,
                     )})`;
      } else {
        sql += ` AND NOT EXISTS (
                   SELECT 1 FROM language_judgment_sessions j
                   WHERE j."scenarioSessionId" = s.id)`;
      }
    }
    sql += ` ORDER BY s."createdAt" DESC`;
    if (opts.limit) sql += ` LIMIT ${p(opts.limit)}`;
    return this.dataSource.query(sql, params);
  }

  /**
   * Judgments that went out without a round-trip WER, newest first.
   *
   * The metric is filled in after the judgment rather than during it, so this
   * is the worklist for that second pass. Scoped to one rubric version because
   * a judgment carries its WER on its own row — an older version's rows are a
   * different population, not a backlog.
   *
   * Newest first so the numbers a reader is most likely to be looking at fill
   * in before the archive does.
   */
  async selectJudgmentsMissingRoundTrip(
    pin: { judgeModel: string; judgePromptVersion: string },
    limit: number,
  ): Promise<Array<{ judgmentId: string; session: LanguageSessionRow }>> {
    const rows: Array<LanguageSessionRow & { judgment_id: string }> =
      await this.dataSource.query(
        `${SESSION_PROJECTION}
           JOIN language_judgment_sessions j ON j."scenarioSessionId" = s.id
          WHERE j."judgeModel" = $1
            AND j."judgePromptVersion" = $2
            AND j."roundTripWerPct" IS NULL
          ORDER BY j."createdAt" DESC
          LIMIT $3`,
        [pin.judgeModel, pin.judgePromptVersion, limit],
      );
    return rows.map(({ judgment_id, ...session }) => ({
      judgmentId: judgment_id,
      session,
    }));
  }

  /**
   * Write a round-trip WER onto an existing judgment.
   *
   * Targeted at the judgment row rather than upserting the whole judgment: the
   * annotations are already written and re-running the upsert would churn them
   * for one nullable number.
   */
  async updateRoundTripWer(judgmentId: string, pct: number): Promise<void> {
    await this.dataSource.query(
      `UPDATE language_judgment_sessions
          SET "roundTripWerPct" = $2, "updatedAt" = now()
        WHERE id = $1`,
      [judgmentId, pct],
    );
  }

  /** Headline prompt version: prefer the main agent prompt, else any. */
  private mainPromptVersion(pv: Record<string, unknown> | null): string | null {
    if (!pv) return null;
    for (const [code, version] of Object.entries(pv)) {
      if (code.includes('main_agent') || code.includes('base_role'))
        return String(version);
    }
    const first = Object.values(pv)[0];
    return first != null ? String(first) : null;
  }

  /**
   * Persist one session's judgment atomically: upsert the session row (the
   * denominator), then DELETE + re-INSERT its annotations. Delete-then-insert
   * (not upsert) because a re-judge can emit FEWER errors — stale rows must go.
   * Different (judgeModel, judgePromptVersion) runs coexist untouched.
   */
  async persistJudgment(
    session: LanguageSessionRow,
    result: LanguageJudgeAiResult,
    judgeModel: string,
    judgePromptVersion: string,
    aiText: Record<number, string>,
    userText: Record<number, string>,
    objective?: {
      scriptFidelityPct?: number | null;
      roundTripWerPct?: number | null;
    },
  ): Promise<void> {
    const promptVersion = this.mainPromptVersion(session.prompt_versions);
    const turnsGarbled = result.per_turn.filter(
      (t) => t.input_garbled && t.input_garbled !== 'none',
    ).length;

    await this.dataSource.transaction(async (em) => {
      const rows = await em.query(
        `INSERT INTO language_judgment_sessions (
           "tenant_id", "scenarioSessionId", "turnsJudged", "turnsGarbled",
           "droppedAnnotations", "language", "scenarioId", "scenarioVersionId",
           "engine", "llmModel", "llmProvider", "promptVersion", "occurredAt",
           "judgeModel", "judgePromptVersion", "scriptFidelityPct",
           "roundTripWerPct", "voiceId", "voiceName"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT ("scenarioSessionId", "judgeModel", "judgePromptVersion")
         DO UPDATE SET
           "turnsJudged" = EXCLUDED."turnsJudged",
           "turnsGarbled" = EXCLUDED."turnsGarbled",
           "droppedAnnotations" = EXCLUDED."droppedAnnotations",
           "language" = EXCLUDED."language",
           "scenarioId" = EXCLUDED."scenarioId",
           "scenarioVersionId" = EXCLUDED."scenarioVersionId",
           "engine" = EXCLUDED."engine",
           "llmModel" = EXCLUDED."llmModel",
           "llmProvider" = EXCLUDED."llmProvider",
           "promptVersion" = EXCLUDED."promptVersion",
           "occurredAt" = EXCLUDED."occurredAt",
           "scriptFidelityPct" = EXCLUDED."scriptFidelityPct",
           "roundTripWerPct" = EXCLUDED."roundTripWerPct",
           "voiceId" = EXCLUDED."voiceId",
           "voiceName" = EXCLUDED."voiceName",
           "updatedAt" = now()
         RETURNING id`,
        [
          session.tenant_id,
          session.id,
          result.turns_judged,
          turnsGarbled,
          result.dropped_annotations,
          session.language,
          session.scenario_id,
          session.scenario_version_id,
          session.engine,
          session.llm_model,
          session.llm_provider,
          promptVersion,
          session.occurred_at,
          judgeModel,
          judgePromptVersion,
          objective?.scriptFidelityPct ?? null,
          objective?.roundTripWerPct ?? null,
          session.voice_id,
          session.voice_name,
        ],
      );
      const judgmentId: string = rows[0].id;

      await em.query(
        `DELETE FROM language_error_annotations
          WHERE "sessionJudgmentId" = $1`,
        [judgmentId],
      );

      for (const turn of result.per_turn) {
        for (const err of turn.errors) {
          await em.query(
            `INSERT INTO language_error_annotations (
               "tenant_id", "scenarioSessionId", "sessionJudgmentId",
               "turnIndex", "layer", "dimension", "category", "severity",
               "isolationBasis", "inputGarbled", "conditionedOut",
               "evidenceQuote", "reasoning", "userText", "aiText",
               "language", "scenarioId", "scenarioVersionId", "engine",
               "llmModel", "llmProvider", "promptVersion", "occurredAt",
               "judgeModel", "judgePromptVersion"
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20,$21,$22,$23,$24,$25
             )`,
            [
              session.tenant_id,
              session.id,
              judgmentId,
              turn.turn_index,
              err.layer,
              err.dimension,
              err.category,
              err.severity,
              err.isolation_basis,
              turn.input_garbled,
              err.conditioned_out,
              err.evidence_quote,
              err.reasoning,
              userText[turn.turn_index] ?? null,
              aiText[turn.turn_index] ?? null,
              session.language,
              session.scenario_id,
              session.scenario_version_id,
              session.engine,
              session.llm_model,
              session.llm_provider,
              promptVersion,
              session.occurred_at,
              judgeModel,
              judgePromptVersion,
            ],
          );
        }
      }
    });
  }
}
