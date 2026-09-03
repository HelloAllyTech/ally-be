import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { countableSessionPredicate } from '../util/session-eligibility.util';

/** Prompt-management code for the filler judge rubric (mirrors the language judge). */
export const FILLER_JUDGE_PROMPT_CODE = 'filler_quality_judge_rubric';

/** See LanguageJudgeRepository for why the default is a `languages.value`. */
export const DEFAULT_JUDGE_LANGUAGE = 'en-IN';
const DEFAULT_JUDGE_LANGUAGE_SQL = `'${DEFAULT_JUDGE_LANGUAGE}'`;

/** AI-side messages are stored with this sender id. */
const AI_SENDER_ID = -1;

export interface FillerSessionRow {
  id: string;
  tenant_id: string;
  scenario_id: number | null;
  scenario_version_id: string | null;
  language: string;
  language_label: string | null;
  persona: string | null;
  prompt_versions: Record<string, unknown> | null;
  occurred_at: Date | null;
  llm_provider: string | null;
  llm_model: string | null;
  engine: string | null;
  /** Authored examples of how the character speaks, per language. */
  style_exemplars: string[] | null;
  /** Discourse particles configured for this language/character. */
  allowed_fillers: string[] | null;
  voice_id: string | null;
  voice_name: string | null;
}

/**
 * One played filler with the context the judge needs. Built here, sent to
 * ally-ai as-is; ally-ai never reads this database.
 */
export interface FillerObservation {
  turn_index: number;
  learner_utterance: string;
  filler_text: string;
  reply_text: string;
  source: string | null;
  filler_type: string | null;
}

/** A finding as returned by the ally-ai filler judge (snake_case on the wire). */
export interface FillerFindingJson {
  dimension: string;
  category: string;
  severity: string;
  evidence_quote: string;
  reasoning: string;
  conditioned_out: boolean;
}

export interface FillerJudgmentJson {
  turn_index: number;
  filler_text: string;
  source: string | null;
  filler_type: string | null;
  findings: FillerFindingJson[];
  repeated_within_window: boolean;
  plays_since_last_use: number | null;
}

export interface FillerJudgeAiResult {
  per_filler: FillerJudgmentJson[];
  fillers_judged: number;
  dropped_annotations: number;
  distinct_phrase_ratio: number | null;
  repeat_window_plays: number;
}

/**
 * Data access for the thinking-filler judge. Sibling of
 * LanguageJudgeRepository, same seam: ally-be selects the sessions, builds the
 * observations from its own tables, and persists what comes back. ally-ai is a
 * stateless transform.
 */
@Injectable()
export class FillerJudgeRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Sessions worth judging: countable sessions that actually PLAYED a filler.
   *
   * The `EXISTS` is what keeps this cheap. Most sessions play no filler at all
   * — the feature is per-scenario opt-in and the predicted-gap gate declines
   * fast turns — and judging them would spend a call to be told there was
   * nothing to judge.
   */
  async selectSessions(opts: {
    since?: string;
    until?: string;
    language?: string;
    scenarioId?: number;
    limit?: number;
    judgeModel: string;
    judgePromptVersion: string;
    rejudge?: boolean;
  }): Promise<FillerSessionRow[]> {
    const params: any[] = [];
    const p = (v: any) => {
      params.push(v);
      return `$${params.length}`;
    };

    let sql = `
      SELECT s.id,
             s."tenant_id" AS tenant_id,
             s."scenarioId" AS scenario_id,
             s."scenarioVersionId" AS scenario_version_id,
             COALESCE(l.value, ${DEFAULT_JUDGE_LANGUAGE_SQL}) AS language,
             l.label AS language_label,
             sc."promptData"->>'description' AS persona,
             s.metadata->'promptVersions' AS prompt_versions,
             s."createdAt" AS occurred_at,
             s.metadata->>'llmProvider' AS llm_provider,
             s.metadata->>'llmModel' AS llm_model,
             s.metadata->>'engine' AS engine,
             sc."promptData"->'linguisticStyleSamples' AS style_exemplars,
             sc."promptData"->'allowedFillerWords' AS allowed_fillers,
             sv."voiceId" AS voice_id,
             sv."voiceName" AS voice_name
        FROM scenario_sessions s
        LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
        LEFT JOIN languages l ON l.id = (s.metadata->>'languageId')::int
        LEFT JOIN scenario_voices sv ON sv."scenarioId" = s."scenarioId"
       WHERE ${countableSessionPredicate('s')}
         AND EXISTS (
               SELECT 1 FROM scenario_session_messages m
                WHERE m."scenarioSessionId" = s.id
                  AND m."senderId" = ${AI_SENDER_ID}
                  AND m.metadata->>'utteranceKind' = 'filler'
             )`;

    if (opts.since) sql += ` AND s."createdAt" >= ${p(opts.since)}`;
    if (opts.until) sql += ` AND s."createdAt" <= ${p(opts.until)}`;
    if (opts.language) sql += ` AND l.value = ${p(opts.language)}`;
    if (opts.scenarioId != null)
      sql += ` AND s."scenarioId" = ${p(opts.scenarioId)}`;

    // Skip what this exact judge version already covered, unless re-judging.
    if (!opts.rejudge) {
      sql += ` AND NOT EXISTS (
                 SELECT 1 FROM filler_judgment_sessions j
                  WHERE j."scenarioSessionId" = s.id
                    AND j."judgeModel" = ${p(opts.judgeModel)}
                    AND j."judgePromptVersion" = ${p(opts.judgePromptVersion)}
               )`;
    }

    sql += ` ORDER BY s."createdAt" DESC`;
    if (opts.limit) sql += ` LIMIT ${p(opts.limit)}`;
    return this.dataSource.query(sql, params);
  }

  /**
   * Build the played-filler observations for one session.
   *
   * The ordering is the whole job. A filler, an interim reply and the real
   * reply all land in `scenario_session_messages` as AI-sender rows, so each
   * filler has to be paired with the learner turn it answered (the most recent
   * preceding counselor line) and the reply that eventually followed it (the
   * next AI line that is a real reply).
   *
   * `metadata->>'utteranceKind'` is what makes that possible. Before it existed
   * the three were indistinguishable, and inferring kind from position fails
   * exactly when it matters — a turn with a continuation filler puts TWO
   * fillers before the reply.
   *
   * Rows returned in PLAY ORDER, which the judge's repeat-distance arithmetic
   * depends on: its window is counted in plays, not turns.
   */
  async buildObservations(sessionId: string): Promise<FillerObservation[]> {
    const rows: {
      sender_id: number;
      content: string | null;
      utterance_kind: string | null;
    }[] = await this.dataSource.query(
      `SELECT "senderId" AS sender_id, content,
              metadata->>'utteranceKind' AS utterance_kind
         FROM scenario_session_messages
        WHERE "scenarioSessionId" = $1
        ORDER BY COALESCE("startSeconds", 0), id`,
      [sessionId],
    );

    // Per-turn filler provenance, keyed by turn index. Recorded by the worker
    // alongside the latency figures; the transcript carries the words, this
    // carries where the phrase came from.
    const metricRows: {
      turn_index: number;
      source: string | null;
      filler_type: string | null;
    }[] = await this.dataSource.query(
      `SELECT "turnIndex" AS turn_index,
              metadata->>'fillerClipSource' AS source,
              metadata->>'fillerType' AS filler_type
         FROM scenario_session_turn_metrics
        WHERE "scenarioSessionId" = $1
          AND metadata->>'fillerDecision' = 'played'`,
      [sessionId],
    );
    const provenance = new Map(metricRows.map((r) => [r.turn_index, r]));

    const observations: FillerObservation[] = [];
    // Fillers awaiting the reply that followed them. A turn can queue two (the
    // continuation), and both are answered by the same reply.
    let pending: FillerObservation[] = [];
    let lastCounselor = '';
    let replyIndex = 0;

    const flush = (replyText: string) => {
      for (const observation of pending) {
        observation.reply_text = replyText;
        observations.push(observation);
      }
      pending = [];
    };

    for (const row of rows) {
      const content = row.content ?? '';
      if (row.sender_id !== AI_SENDER_ID) {
        // A learner turn while fillers are still pending means the reply never
        // arrived (the turn was abandoned or the session ended). Keep them —
        // they were heard — with whatever reply text they have, which is none.
        flush('');
        lastCounselor = content;
        continue;
      }

      const kind = row.utterance_kind;
      if (kind === 'filler') {
        const meta = provenance.get(replyIndex);
        pending.push({
          turn_index: replyIndex,
          learner_utterance: lastCounselor,
          filler_text: content,
          reply_text: '',
          source: meta?.source ?? null,
          filler_type: meta?.filler_type ?? null,
        });
        continue;
      }
      if (kind === 'interim') {
        // Heard by the learner, but a different feature with its own rules —
        // it is allowed to say something, which is the whole point of it.
        continue;
      }

      // A real reply (or an unmarked line from a worker predating the field,
      // which is far more likely to be a reply than a filler).
      flush(content);
      replyIndex += 1;
    }
    // Trailing fillers with no reply after them: the session ended mid-turn.
    flush('');

    return observations;
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
   * Persist one judge run: the session denominator row plus its findings.
   *
   * Findings are DELETEd and re-INSERTed rather than upserted, because a
   * re-judge can produce FEWER findings than the run before it and an upsert
   * would leave the vanished ones behind, permanently overstating the rate.
   */
  async persistJudgment(
    session: FillerSessionRow,
    result: FillerJudgeAiResult,
    judgeModel: string,
    judgePromptVersion: string,
  ): Promise<void> {
    const promptVersion = this.mainPromptVersion(session.prompt_versions);
    const repeatedFillers = result.per_filler.filter(
      (f) => f.repeated_within_window,
    ).length;

    await this.dataSource.transaction(async (em) => {
      const rows = await em.query(
        `INSERT INTO filler_judgment_sessions (
           "tenant_id", "scenarioSessionId", "fillersJudged",
           "distinctPhraseRatio", "repeatedFillers", "droppedAnnotations",
           "language", "scenarioId", "scenarioVersionId", "engine",
           "llmModel", "llmProvider", "promptVersion", "occurredAt",
           "judgeModel", "judgePromptVersion", "voiceId", "voiceName"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT ("scenarioSessionId", "judgeModel", "judgePromptVersion")
         DO UPDATE SET
           "fillersJudged" = EXCLUDED."fillersJudged",
           "distinctPhraseRatio" = EXCLUDED."distinctPhraseRatio",
           "repeatedFillers" = EXCLUDED."repeatedFillers",
           "droppedAnnotations" = EXCLUDED."droppedAnnotations",
           "language" = EXCLUDED."language",
           "scenarioId" = EXCLUDED."scenarioId",
           "scenarioVersionId" = EXCLUDED."scenarioVersionId",
           "engine" = EXCLUDED."engine",
           "llmModel" = EXCLUDED."llmModel",
           "llmProvider" = EXCLUDED."llmProvider",
           "promptVersion" = EXCLUDED."promptVersion",
           "occurredAt" = EXCLUDED."occurredAt",
           "voiceId" = EXCLUDED."voiceId",
           "voiceName" = EXCLUDED."voiceName",
           "updatedAt" = now()
         RETURNING id`,
        [
          session.tenant_id,
          session.id,
          result.fillers_judged,
          result.distinct_phrase_ratio,
          repeatedFillers,
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
          session.voice_id,
          session.voice_name,
        ],
      );
      const judgmentId: string = rows[0].id;

      await em.query(
        `DELETE FROM filler_finding_annotations
          WHERE "sessionJudgmentId" = $1`,
        [judgmentId],
      );

      for (const filler of result.per_filler) {
        for (const finding of filler.findings) {
          await em.query(
            `INSERT INTO filler_finding_annotations (
               "tenant_id", "scenarioSessionId", "sessionJudgmentId",
               "turnIndex", "dimension", "category", "severity",
               "conditionedOut", "evidenceQuote", "reasoning", "fillerText",
               "source", "fillerType", "language", "scenarioId",
               "scenarioVersionId", "engine", "llmModel", "llmProvider",
               "promptVersion", "occurredAt", "judgeModel", "judgePromptVersion"
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20,$21,$22,$23
             )`,
            [
              session.tenant_id,
              session.id,
              judgmentId,
              filler.turn_index,
              finding.dimension,
              finding.category,
              finding.severity,
              finding.conditioned_out,
              finding.evidence_quote,
              finding.reasoning,
              filler.filler_text,
              filler.source,
              filler.filler_type,
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
