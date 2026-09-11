import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** A turn's recall decision, awaiting a verdict. */
export interface RecallTurnRow {
  id: string;
  tenant_id: string | null;
  scenario_session_id: string;
  turn_index: number;
  stance: string | null;
  cue_tier: string;
  pool_size: number;
  selected: Record<string, unknown>[];
  passed_over: Record<string, unknown>[];
  occurred_at: Date;
}

/** The two halves of the turn, paired out of the transcript. */
export interface RecallTurnText {
  counsellor_turn: string;
  client_reply: string;
}

export interface RecallJudgmentInput {
  verdict: string;
  better_fact?: string | null;
  unused_selected?: string[] | null;
  reasoning?: string | null;
}

/**
 * Data access for the recall-quality judge.
 *
 * Same division as every other judge here: ally-be selects, pairs and persists; ally-ai only
 * judges.
 *
 * THE PAIRING IS THE RISK IN THIS FILE. `wm_recall_selections.turnIndex` counts LEARNER turns,
 * 1-based — the worker's store pre-increments once per learner turn before the reply is
 * generated. So turn N is the Nth counsellor message and the client message that follows it.
 * Get that wrong by one and the judge returns confident verdicts about a conversation that
 * never happened, which is worse than no verdicts at all. Hence `buildTurnText` returns null
 * rather than a best guess whenever the transcript cannot support the index, and the caller
 * skips the row.
 */
@Injectable()
export class RecallQualityRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** The rubric from prompt management; null falls back to ally-ai's inline default. */
  async fetchRubric(): Promise<string | null> {
    const rows = await this.dataSource.query(
      `SELECT pv.prompt
         FROM prompts p
         JOIN prompts_versions pv
           ON pv."promptId" = p.id AND pv.version = p."currentVersion"
        WHERE p."promptCode" = 'recall_quality_rubric'
        LIMIT 1`,
    );
    return rows?.[0]?.prompt ?? null;
  }

  /**
   * Turns not yet judged under the target version.
   *
   * Requires a pool: a turn where recall had nothing to choose from was never a ranking
   * decision, and judging it would manufacture a verdict about an empty choice.
   */
  async selectTurns(opts: {
    sinceDays?: number | null;
    limit?: number | null;
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null;
  }): Promise<RecallTurnRow[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };

    let sql = `
      SELECT r.id,
             r.tenant_id,
             r."scenarioSessionId" AS scenario_session_id,
             r."turnIndex" AS turn_index,
             r.stance,
             r.cue_tier,
             r.pool_size,
             r.selected,
             r.passed_over,
             r."createdAt" AS occurred_at
        FROM wm_recall_selections r
       WHERE jsonb_array_length(COALESCE(r.selected, '[]'::jsonb))
             + jsonb_array_length(COALESCE(r.passed_over, '[]'::jsonb)) > 0`;

    if (opts.sinceDays != null) {
      sql += ` AND r."createdAt" >= now() - make_interval(days => ${p(
        opts.sinceDays,
      )})`;
    }
    if (opts.unjudgedForVersion) {
      sql += ` AND NOT EXISTS (
                 SELECT 1 FROM wm_recall_judgments j
                  WHERE j.recall_selection_id = r.id
                    AND j.judge_model = ${p(opts.unjudgedForVersion.judgeModel)}
                    AND j.judge_prompt_version = ${p(
                      opts.unjudgedForVersion.judgePromptVersion,
                    )})`;
    }
    sql += ` ORDER BY r."createdAt" DESC`;
    if (opts.limit) sql += ` LIMIT ${p(opts.limit)}`;
    return this.dataSource.query(sql, params);
  }

  /**
   * The counsellor turn at `turnIndex` and the client's reply to it, or null.
   *
   * Null rather than a partial pair whenever the transcript cannot support the index — a
   * session that ended mid-turn, a redelivered recall row for a turn whose messages never
   * persisted, or any off-by-one in the convention above. A judge fed the wrong turn does not
   * fail; it answers confidently about the wrong thing.
   *
   * `senderId = -1` is the AI client; anything else is the counsellor (the convention the
   * drift, language and groundedness judges all read).
   */
  async buildTurnText(
    sessionId: string,
    turnIndex: number,
  ): Promise<RecallTurnText | null> {
    if (!Number.isInteger(turnIndex) || turnIndex < 1) return null;

    const rows = (await this.dataSource.query(
      `SELECT "senderId" AS sender_id, content
         FROM scenario_session_messages
        WHERE "scenarioSessionId" = $1
        ORDER BY "createdAt" ASC, id ASC`,
      [sessionId],
    )) as Array<{ sender_id: number; content: string | null }>;

    let counsellorSeen = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const isClient = Number(rows[i].sender_id) === -1;
      if (isClient) continue;

      counsellorSeen += 1;
      if (counsellorSeen !== turnIndex) continue;

      const counsellorTurn = (rows[i].content ?? '').trim();
      // The client's reply is the next client message, if the session got that far.
      const reply = rows.slice(i + 1).find((r) => Number(r.sender_id) === -1);
      const clientReply = (reply?.content ?? '').trim();

      if (!counsellorTurn && !clientReply) return null;
      return { counsellor_turn: counsellorTurn, client_reply: clientReply };
    }

    // Fewer counsellor turns than the index claims: the pairing cannot be trusted.
    return null;
  }

  /**
   * Persist one turn's verdict.
   *
   * Upsert on (selection, judgeModel, judgePromptVersion): a re-judge under the same version
   * corrects itself, a new rubric writes alongside the old, and an interrupted run is
   * resumable because "already judged" means judged by THIS pair.
   */
  async upsertJudgment(
    turn: RecallTurnRow,
    judgment: RecallJudgmentInput,
    judgeModel: string,
    judgePromptVersion: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO wm_recall_judgments (
         tenant_id, recall_selection_id, "scenarioSessionId", "turnIndex",
         verdict, better_fact, unused_selected_count, reasoning,
         stance, cue_tier, pool_size, occurred_at,
         judge_model, judge_prompt_version
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (recall_selection_id, judge_model, judge_prompt_version)
       DO UPDATE SET
         verdict = EXCLUDED.verdict,
         better_fact = EXCLUDED.better_fact,
         unused_selected_count = EXCLUDED.unused_selected_count,
         reasoning = EXCLUDED.reasoning,
         "updatedAt" = now()`,
      [
        turn.tenant_id,
        turn.id,
        turn.scenario_session_id,
        turn.turn_index,
        judgment.verdict,
        judgment.better_fact?.trim() ? judgment.better_fact : null,
        (judgment.unused_selected ?? []).length,
        judgment.reasoning?.trim() ? judgment.reasoning : null,
        turn.stance,
        turn.cue_tier,
        turn.pool_size,
        turn.occurred_at,
        judgeModel,
        judgePromptVersion,
      ],
    );
  }
}
