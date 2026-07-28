import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * scenario_session_details: one row per session, enforced.
 *
 * Session end fired two concurrent writers — the evaluation path
 * (find-then-create) and the summary path (blind INSERT) — and with no unique
 * constraint on "scenarioSessionId" ~half of all sessions ended up with TWO
 * details rows: one carrying the summary, one carrying the evaluation fields.
 * The read path (leftJoinAndMapOne) then mapped an arbitrary row, so the app
 * intermittently showed no AI feedback even though it existed (and the GET
 * 500'd on the null-summary dereference).
 *
 * This migration (1) merges duplicates by coalescing every payload column
 * into one canonical row per session — preferring rows that have a summary,
 * then newest — (2) deletes the rest, and (3) replaces the non-unique index
 * with a UNIQUE one so the writers' new ON CONFLICT upserts have a target and
 * duplicates are impossible thereafter.
 */
export class MergeDuplicateScenarioSessionDetails1869000000000 implements MigrationInterface {
  name = 'MergeDuplicateScenarioSessionDetails1869000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Coalesce all payload columns into the canonical row per session.
    //    pick(col): first non-null value, scanning rows summary-first, newest
    //    first — so a complete summary row wins over an evaluation-only row,
    //    and newer values win over older ones.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id, "scenarioSessionId",
               ROW_NUMBER() OVER (
                 PARTITION BY "scenarioSessionId"
                 ORDER BY (summary IS NOT NULL) DESC, "createdAt" DESC
               ) AS rn
        FROM scenario_session_details
      ),
      dup_sessions AS (
        SELECT "scenarioSessionId" FROM ranked GROUP BY 1 HAVING count(*) > 1
      ),
      merged AS (
        SELECT d."scenarioSessionId",
          (array_remove(array_agg(d."callDuration" ORDER BY r.rn), NULL))[1]        AS call_duration,
          (array_remove(array_agg(d.summary ORDER BY r.rn), NULL))[1]               AS summary,
          (array_remove(array_agg(d.metrics ORDER BY r.rn), NULL))[1]               AS metrics,
          (array_remove(array_agg(d."compositeScore" ORDER BY r.rn), NULL))[1]      AS composite_score,
          (array_remove(array_agg(d."evaluationMarkdown" ORDER BY r.rn), NULL))[1]  AS evaluation_markdown,
          (array_remove(array_agg(d."evaluationStatus" ORDER BY r.rn), NULL))[1]    AS evaluation_status,
          (array_remove(array_agg(d."evaluatedAt" ORDER BY r.rn), NULL))[1]         AS evaluated_at
        FROM scenario_session_details d
        JOIN ranked r ON r.id = d.id
        WHERE d."scenarioSessionId" IN (SELECT "scenarioSessionId" FROM dup_sessions)
        GROUP BY d."scenarioSessionId"
      )
      UPDATE scenario_session_details t
      SET "callDuration"       = m.call_duration,
          summary              = m.summary,
          metrics              = m.metrics,
          "compositeScore"     = m.composite_score,
          "evaluationMarkdown" = m.evaluation_markdown,
          "evaluationStatus"   = m.evaluation_status,
          "evaluatedAt"        = m.evaluated_at,
          "updatedAt"          = now()
      FROM merged m, ranked r
      WHERE t.id = r.id AND r.rn = 1
        AND m."scenarioSessionId" = t."scenarioSessionId"
    `);

    // 2) Delete the now-redundant non-canonical rows.
    await queryRunner.query(`
      DELETE FROM scenario_session_details t
      USING (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY "scenarioSessionId"
                 ORDER BY (summary IS NOT NULL) DESC, "createdAt" DESC
               ) AS rn
        FROM scenario_session_details
      ) r
      WHERE t.id = r.id AND r.rn > 1
    `);

    // 3) Enforce one row per session; the unique index also serves the same
    //    lookups the old non-unique one did.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "scenario_session_details_scenario_session_id_idx"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "scenario_session_details_scenario_session_id_idx"
        ON scenario_session_details ("scenarioSessionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Merged/deleted duplicate rows are not restorable; only relax the
    // uniqueness back to a plain index.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "scenario_session_details_scenario_session_id_idx"`,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_details_scenario_session_id_idx"
        ON scenario_session_details ("scenarioSessionId")`,
    );
  }
}
