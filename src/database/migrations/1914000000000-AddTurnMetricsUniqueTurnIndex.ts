import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One row per (scenarioSessionId, turnIndex, source) on
 * scenario_session_turn_metrics.
 *
 * The write path (TurnMetricsProcessor -> ScenarioSessionService.addTurnMetrics)
 * is a blind `repo.save()` of a fresh entity behind an at-least-once SQS queue,
 * and the processor rethrows on failure so the message is redelivered. Nothing
 * stopped a redelivery from inserting a second row for a turn that was already
 * recorded, which would double-count that turn in every latency and
 * weak-metrics aggregate — the same shape as the duplicate
 * scenario_session_details rows that once hid session feedback.
 *
 * `source` is deliberately part of the key rather than filtered out of it: a
 * turn legitimately has both a live `pipeline` row and a `transcript`
 * backfilled row, and those are two different measurements we want to keep
 * side by side. Verified against production 2026-08-20 — 392 turns hold one of
 * each, and zero turns hold two rows of the same source — so this index
 * creates without any cleanup.
 */
export class AddTurnMetricsUniqueTurnIndex1914000000000 implements MigrationInterface {
  name = 'AddTurnMetricsUniqueTurnIndex1914000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Defensive: collapse any same-source duplicate that appears between the
    // production check above and this migration running, keeping the earliest
    // row so the first (live) measurement wins.
    await queryRunner.query(`
      DELETE FROM scenario_session_turn_metrics t
       USING scenario_session_turn_metrics keep
       WHERE t."scenarioSessionId" = keep."scenarioSessionId"
         AND t."turnIndex"         = keep."turnIndex"
         AND t.source              = keep.source
         AND t."createdAt"         > keep."createdAt"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "scenario_session_turn_metrics_session_turn_source_uq"
        ON scenario_session_turn_metrics
           ("scenarioSessionId", "turnIndex", source)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "scenario_session_turn_metrics_session_turn_source_uq"
    `);
  }
}
