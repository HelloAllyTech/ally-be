import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make "at most one RUNNING scan" a database fact rather than a comment.
 *
 * Migration 1940200000000 created `idx_ux_signal_scans_running` and said in its
 * own comment that there should be at most one RUNNING row — but a plain index
 * enforces nothing, and the guard above it was a `COUNT(*)` followed by an
 * `INSERT`. Two "Scan now" presses a few milliseconds apart (a double-click, or a
 * retry of a request that looked hung) both read zero in flight before either had
 * committed, so both started: two triage calls billed for one week of telemetry,
 * and two near-identical cards in a review queue whose whole value is that a human
 * can read it in one pass. A check-then-insert race can only be closed where the
 * insert happens, so it is closed here.
 *
 * The index is on `status` rather than on a constant expression: every row that
 * satisfies the partial predicate has `status = 'running'`, so uniqueness on that
 * column means uniqueness across the whole predicate — one RUNNING row, table-wide.
 * It also serves the in-flight count, which is the only query that reads it.
 *
 * `idx_ux_signal_scans_running` is deliberately left in place. It orders the stale
 * sweep's `started_at` predicate, and dropping a merged migration's index is not
 * this change's business.
 *
 * The pre-clean is the same judgement `assertNoScanInFlight` already makes:
 * anything RUNNING that a newer RUNNING row has overtaken was abandoned by a crash
 * or a redeploy, because nothing was ever allowed to start alongside it on purpose.
 * The newest RUNNING row is kept as-is — it may be a live scan mid-flight, and
 * failing it would make a scan that is about to succeed report as broken.
 */
export class EnforceSingleRunningUxSignalScan1940800000000 implements MigrationInterface {
  name = 'EnforceSingleRunningUxSignalScan1940800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "ux_signal_scans"
          SET "status" = 'failed',
              "error" = COALESCE(
                "error",
                'Abandoned: a later scan had already started, so no result could be recorded.'
              ),
              "finished_at" = COALESCE("finished_at", now())
        WHERE "status" = 'running'
          AND "id" <> (
            SELECT "id" FROM "ux_signal_scans"
             WHERE "status" = 'running'
             ORDER BY "started_at" DESC, "id" DESC
             LIMIT 1
          )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_ux_signal_scans_single_running"
         ON "ux_signal_scans" ("status")
       WHERE "status" = 'running'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_ux_signal_scans_single_running"`,
    );
  }
}
