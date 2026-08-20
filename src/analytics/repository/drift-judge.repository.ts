import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Prompt-management code for the drift judge rubric (seeded by migration). */
export const DRIFT_JUDGE_PROMPT_CODE = 'drift_judge_conversation_rubric';

/** scenario_session_messages.senderId == -1 marks the AI client's turn. */
const AI_SENDER_ID = -1;

export interface DriftSessionRow {
  id: string;
  tenant_id: string;
  scenario_id: number | null;
  scenario_version_id: string | null;
  language: string;
  persona: string | null;
  prompt_versions: Record<string, unknown> | null;
  occurred_at: Date | null;
  llm_provider: string | null;
  llm_model: string | null;
}

export interface TranscriptTurn {
  role: 'client' | 'counselor';
  text: string;
  turn_index?: number;
  /**
   * The learner talked over this client turn, so `text` is only the part of the
   * reply that reached TTS before it stopped — a prefix of what the model
   * produced. Measured across judged turns, a cut turn keeps ~36% of the
   * generated characters against ~107% on an uncut one, which is why
   * `truncation` became the second-largest annotation category.
   *
   * Sourced from the message's own metadata, written by the worker from the
   * LiveKit ChatMessage. Set only when TRUE: a message without the flag is one
   * whose worker never reported it, which is not the same as a turn that was
   * not interrupted, and the judge conditions on presence for that reason.
   */
  interrupted?: boolean;
}

export interface BuiltTranscript {
  transcript: TranscriptTurn[];
  aiText: Record<number, string>;
  userText: Record<number, string>;
}

/** One per-turn judgment as returned by the ally-ai judge (snake_case). */
export interface PerTurnJudgment {
  turn_index: number;
  coherence: string;
  topic_label: string;
  in_character: boolean;
  counselor_utterance_garbled: string;
  stt_error_type: string;
  ai_reply_failure_mode: string;
  root_attribution: string;
  reasoning: string;
  // v2 labels. Optional because a v1 judge response omits them entirely, and
  // because a judge that drops one should degrade to "not observed" rather
  // than failing the whole session.
  role_inversion?: boolean | null;
  offered_solution?: boolean | null;
  solutions_offered?: number | null;
  introduced_new_information?: boolean | null;
  stuck_is_appropriate?: boolean | null;
  resistance_briefed?: boolean | null;
}

export interface SessionRollup {
  drifted: boolean;
  first_drift_turn: number | null;
}

/**
 * Data access for drift judging. ally-be owns these tables, so the
 * orchestration (select → build transcript → persist) lives here; the Gemini
 * judge itself is a stateless call out to ally-ai. SQL ported from the former
 * ally-ai runner so behaviour is identical.
 */
@Injectable()
export class DriftJudgeRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Current rubric from prompt management; null if absent (judge falls back). */
  async fetchRubric(): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT pv.prompt
         FROM prompts p
         LEFT JOIN prompts_versions pv
           ON p.id = pv."promptId" AND pv.version = p."currentVersion"
        WHERE p."promptCode" = $1`,
      [DRIFT_JUDGE_PROMPT_CODE],
    );
    return rows?.[0]?.prompt ?? null;
  }

  /**
   * Sessions to judge. Excludes admin-dashboard previews (roomId 'preview-%').
   * `sinceDays` limits to recently-created sessions; `onlyUnjudged` skips any
   * session that already has a judgment row (idempotent catch-up). Experiment
   * fields (provider/model) come from the session's turn metrics.
   */
  async selectSessions(opts: {
    sinceDays?: number | null;
    language?: string | null;
    onlyUnjudged?: boolean;
    limit?: number | null;
    /**
     * Scope "already judged" to ONE judge version.
     *
     * Without this, `onlyUnjudged` means "has any judgment row at all", which
     * makes a re-judge under a new rubric a no-op over exactly the sessions
     * worth re-judging — every one of them already has v1 rows. Passing the
     * target version instead selects sessions not yet judged UNDER THAT
     * VERSION, which also makes the run resumable: re-issue it after a failure
     * and it picks up where it stopped rather than starting over.
     *
     * Omitted = the old version-agnostic behaviour, for a first-time backfill.
     */
    /**
     * Lean backfill only: require a judgment under THIS version to already
     * exist. The lean pass copies an existing row forward and fills in the
     * added labels, so a session with nothing to copy would silently produce
     * no row at all — it must be excluded from the run, not attempted.
     */
    judgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null;
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null;
  }): Promise<DriftSessionRow[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    let sql = `
      SELECT s.id,
             s.tenant_id        AS tenant_id,
             s."scenarioId"     AS scenario_id,
             s."scenarioVersionId" AS scenario_version_id,
             COALESCE(l.value, 'en') AS language,
             sc.prompt          AS persona,
             s.metadata->'promptVersions' AS prompt_versions,
             s."createdAt"      AS occurred_at,
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
      LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
      WHERE s."roomId" NOT LIKE 'preview-%'`;
    if (opts.language)
      sql += ` AND COALESCE(l.value, 'en') = ${p(opts.language)}`;
    if (opts.sinceDays != null)
      sql += ` AND s."createdAt" >= now() - make_interval(days => ${p(opts.sinceDays)})`;
    if (opts.onlyUnjudged) {
      if (opts.unjudgedForVersion) {
        sql += ` AND NOT EXISTS (
                   SELECT 1 FROM turn_drift_judgment j
                   WHERE j."scenarioSessionId" = s.id
                     AND j."judgeModel" = ${p(opts.unjudgedForVersion.judgeModel)}
                     AND j."judgePromptVersion" = ${p(
                       opts.unjudgedForVersion.judgePromptVersion,
                     )})`;
      } else {
        sql += ` AND NOT EXISTS (
                   SELECT 1 FROM turn_drift_judgment j
                   WHERE j."scenarioSessionId" = s.id)`;
      }
    }
    if (opts.judgedForVersion) {
      sql += ` AND EXISTS (
                 SELECT 1 FROM turn_drift_judgment j
                 WHERE j."scenarioSessionId" = s.id
                   AND j."judgeModel" = ${p(opts.judgedForVersion.judgeModel)}
                   AND j."judgePromptVersion" = ${p(
                     opts.judgedForVersion.judgePromptVersion,
                   )})`;
    }
    sql += ` ORDER BY s."createdAt" DESC`;
    if (opts.limit) sql += ` LIMIT ${p(opts.limit)}`;
    return this.dataSource.query(sql, params);
  }

  /**
   * Build the whole-session transcript. Turn indices are assigned to AI-client
   * turns chronologically; an AI turn's "user text" is the most recent
   * preceding counselor utterance. Mirrors the former Python build_transcript.
   */
  async buildTranscript(sessionId: string): Promise<BuiltTranscript> {
    // `metadata->>'interrupted'` comes from the worker, which reads it off the
    // LiveKit ChatMessage it is publishing — the authoritative per-utterance
    // signal. An earlier version of this method derived it by joining
    // scenario_session_turn_metrics.interrupted instead, which was wrong in
    // three ways: that column went unwritten before 2026-08-17, it only exists
    // on `pipeline` rows, and it is a turn-level flag reconstructed from a
    // playback handler rather than the message's own truth.
    const rows: {
      sender_id: number;
      content: string | null;
      interrupted: string | null;
    }[] = await this.dataSource.query(
      `SELECT "senderId" AS sender_id, content,
                metadata->>'interrupted' AS interrupted
           FROM scenario_session_messages
          WHERE "scenarioSessionId" = $1
          ORDER BY COALESCE("startSeconds", 0), id`,
      [sessionId],
    );
    const transcript: TranscriptTurn[] = [];
    const aiText: Record<number, string> = {};
    const userText: Record<number, string> = {};
    let aiIdx = 0;
    let lastCounselor = '';
    for (const r of rows) {
      const content = r.content ?? '';
      if (r.sender_id === AI_SENDER_ID) {
        transcript.push({
          role: 'client',
          turn_index: aiIdx,
          text: content,
          // Only when the worker actually said so. A message with no flag is
          // from a worker that did not report it, which is not the same as a
          // turn that was not interrupted — the judge conditions on presence.
          ...(r.interrupted === 'true' && { interrupted: true }),
        });
        aiText[aiIdx] = content;
        userText[aiIdx] = lastCounselor;
        aiIdx += 1;
      } else {
        transcript.push({ role: 'counselor', text: content });
        lastCounselor = content;
      }
    }
    return { transcript, aiText, userText };
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
   * Top up an ALREADY-JUDGED session with the labels the v2 rubric added.
   *
   * The backfill counterpart to `upsertJudgments`: instead of writing a fresh
   * judgment, it copies the existing row's v1 fields into a row stamped with
   * the new judge version and fills in the six added labels. One row per turn
   * carrying everything, so the dashboard keeps pinning a single
   * (judgeModel, judgePromptVersion) pair and never reads across rubrics.
   *
   * Copying the old values forward is only sound because v2 ADDED sections to
   * the rubric and changed no existing definition — verified against the prompt
   * diff. The day a rubric edit changes what an existing label MEANS, this path
   * is invalid for that label and the session needs a full re-judge; there is
   * no way for this code to detect that, so it is written down here.
   *
   * Provenance goes in `metadata`, because a row that looks fully v2-judged but
   * whose older fields came from an earlier pass is a trap for whoever audits
   * this in six months.
   */
  async mergeLeanLabels(
    sessionId: string,
    perTurn: Array<{
      turn_index: number;
      role_inversion?: boolean | null;
      offered_solution?: boolean | null;
      solutions_offered?: number | null;
      resistance_briefed?: boolean | null;
      introduced_new_information?: boolean | null;
      stuck_is_appropriate?: boolean | null;
      reasoning?: string | null;
    }>,
    sourceVersion: { judgeModel: string; judgePromptVersion: string },
    targetVersion: { judgeModel: string; judgePromptVersion: string },
  ): Promise<number> {
    let merged = 0;
    for (const t of perTurn) {
      const res = await this.dataSource.query(
        `INSERT INTO turn_drift_judgment (
           "tenant_id", "scenarioSessionId", "turnIndex", "coherence",
           "topicLabel", "inCharacter", "counselorUtteranceGarbled",
           "sttErrorType", "aiReplyFailureMode", "rootAttribution",
           "reasoning", "userText", "aiText", "language", "scenarioId",
           "llmProvider", "llmModel", "occurredAt", "promptVersion",
           "sessionDrifted", "firstDriftTurn", "scenarioVersionId",
           "judgeModel", "judgePromptVersion", "metadata",
           "roleInversion", "offeredSolution", "solutionsOffered",
           "resistanceBriefed", "introducedNewInformation", "stuckIsAppropriate"
         )
         SELECT src."tenant_id", src."scenarioSessionId", src."turnIndex",
                src."coherence", src."topicLabel", src."inCharacter",
                src."counselorUtteranceGarbled", src."sttErrorType",
                src."aiReplyFailureMode", src."rootAttribution",
                src."reasoning", src."userText", src."aiText", src."language",
                src."scenarioId", src."llmProvider", src."llmModel",
                src."occurredAt", src."promptVersion", src."sessionDrifted",
                src."firstDriftTurn", src."scenarioVersionId",
                $4, $5,
                COALESCE(src."metadata", '{}'::jsonb) || jsonb_build_object(
                  'labelsBackfill', jsonb_build_object(
                    'from', jsonb_build_object(
                      'judgeModel', src."judgeModel",
                      'judgePromptVersion', src."judgePromptVersion"),
                    'labelsOnly', true)),
                $6, $7, $8, $9, $10, $11
           FROM turn_drift_judgment src
          WHERE src."scenarioSessionId" = $1
            AND src."turnIndex" = $2
            AND src."judgeModel" = $3
            AND src."judgePromptVersion" = $12
         ON CONFLICT ("scenarioSessionId", "turnIndex", "judgeModel", "judgePromptVersion")
         DO UPDATE SET
           "roleInversion" = EXCLUDED."roleInversion",
           "offeredSolution" = EXCLUDED."offeredSolution",
           "solutionsOffered" = EXCLUDED."solutionsOffered",
           "resistanceBriefed" = EXCLUDED."resistanceBriefed",
           "introducedNewInformation" = EXCLUDED."introducedNewInformation",
           "stuckIsAppropriate" = EXCLUDED."stuckIsAppropriate",
           "metadata" = EXCLUDED."metadata",
           "updatedAt" = now()`,
        [
          sessionId,
          t.turn_index,
          sourceVersion.judgeModel,
          targetVersion.judgeModel,
          targetVersion.judgePromptVersion,
          t.role_inversion ?? null,
          t.offered_solution ?? null,
          t.solutions_offered ?? null,
          t.resistance_briefed ?? null,
          t.introduced_new_information ?? null,
          t.stuck_is_appropriate ?? null,
          sourceVersion.judgePromptVersion,
        ],
      );
      // `?? null` on every label, never `?? false`: a turn the judge declined
      // to label must leave the denominator, not enter the numerator.
      merged += Array.isArray(res) ? 0 : 1;
    }
    return merged;
  }

  /** Upsert all per-turn judgments for a session (idempotent on the unique key). */
  async upsertJudgments(
    session: DriftSessionRow,
    perTurn: PerTurnJudgment[],
    rollup: SessionRollup,
    judgeModel: string,
    judgePromptVersion: string,
    aiText: Record<number, string>,
    userText: Record<number, string>,
  ): Promise<void> {
    const promptVersion = this.mainPromptVersion(session.prompt_versions);
    for (const t of perTurn) {
      await this.dataSource.query(
        `INSERT INTO turn_drift_judgment (
           "tenant_id", "scenarioSessionId", "turnIndex", "coherence",
           "topicLabel", "inCharacter", "counselorUtteranceGarbled",
           "sttErrorType", "aiReplyFailureMode", "rootAttribution",
           "reasoning", "userText", "aiText", "language", "scenarioId",
           "llmProvider", "llmModel", "occurredAt",
           "promptVersion", "sessionDrifted", "firstDriftTurn",
           "judgeModel", "judgePromptVersion", "scenarioVersionId",
           "roleInversion", "offeredSolution", "solutionsOffered",
           "introducedNewInformation", "stuckIsAppropriate", "resistanceBriefed"
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
           $16, $17, $18, $19, $20, $21, $22, $23, $24,
           $25, $26, $27, $28, $29, $30
         )
         ON CONFLICT ("scenarioSessionId", "turnIndex", "judgeModel", "judgePromptVersion")
         DO UPDATE SET
           "coherence" = EXCLUDED."coherence",
           "topicLabel" = EXCLUDED."topicLabel",
           "inCharacter" = EXCLUDED."inCharacter",
           "counselorUtteranceGarbled" = EXCLUDED."counselorUtteranceGarbled",
           "sttErrorType" = EXCLUDED."sttErrorType",
           "aiReplyFailureMode" = EXCLUDED."aiReplyFailureMode",
           "rootAttribution" = EXCLUDED."rootAttribution",
           "reasoning" = EXCLUDED."reasoning",
           "userText" = EXCLUDED."userText",
           "aiText" = EXCLUDED."aiText",
           "llmProvider" = EXCLUDED."llmProvider",
           "llmModel" = EXCLUDED."llmModel",
           "occurredAt" = EXCLUDED."occurredAt",
           "promptVersion" = EXCLUDED."promptVersion",
           "sessionDrifted" = EXCLUDED."sessionDrifted",
           "firstDriftTurn" = EXCLUDED."firstDriftTurn",
           "roleInversion" = EXCLUDED."roleInversion",
           "offeredSolution" = EXCLUDED."offeredSolution",
           "solutionsOffered" = EXCLUDED."solutionsOffered",
           "introducedNewInformation" = EXCLUDED."introducedNewInformation",
           "stuckIsAppropriate" = EXCLUDED."stuckIsAppropriate",
           "resistanceBriefed" = EXCLUDED."resistanceBriefed",
           "updatedAt" = now()`,
        [
          session.tenant_id,
          session.id,
          t.turn_index,
          t.coherence,
          t.topic_label,
          t.in_character,
          t.counselor_utterance_garbled,
          t.stt_error_type,
          t.ai_reply_failure_mode,
          t.root_attribution,
          t.reasoning,
          userText[t.turn_index] ?? null,
          aiText[t.turn_index] ?? null,
          session.language,
          session.scenario_id,
          session.llm_provider,
          session.llm_model,
          session.occurred_at,
          promptVersion,
          rollup.drifted,
          rollup.first_drift_turn,
          judgeModel,
          judgePromptVersion,
          session.scenario_version_id,
          // `?? null` rather than `?? false`: a judge that did not answer must
          // land as "not observed", never as a clean negative.
          t.role_inversion ?? null,
          t.offered_solution ?? null,
          t.solutions_offered ?? null,
          t.introduced_new_information ?? null,
          t.stuck_is_appropriate ?? null,
          t.resistance_briefed ?? null,
        ],
      );
    }
  }
}
