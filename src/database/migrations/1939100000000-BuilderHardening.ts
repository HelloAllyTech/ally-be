import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Builder spend and concurrency hardening.
 *
 * - `builder_sessions.lastRunSequence` — the atomic run counter. Run numbers
 *   were read-then-incremented off `MAX(sequence)`, so two dispatches for one
 *   session (a double-clicked answer was enough) could collide. Backfilled
 *   from the runs that already exist so existing sessions keep counting up
 *   rather than restarting at 1 and colliding immediately.
 * - `builder_settings.maxRunnerMinutes` — a ceiling on GitHub Actions minutes
 *   per session. Dollars and runner minutes are separate budgets: a run can be
 *   cheap in tokens and still hold a runner for two hours, and `totalCostUsd`
 *   says nothing about that. Left NULL (no ceiling) so this migration changes
 *   no behaviour until someone sets one.
 */
export class BuilderHardening1939100000000 implements MigrationInterface {
  name = 'BuilderHardening1939100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions"
         ADD COLUMN IF NOT EXISTS "lastRunSequence" integer NOT NULL DEFAULT 0`,
    );
    // Without the backfill the counter would hand out 1 to a session that
    // already has runs 1..3, and the very next dispatch would collide.
    await queryRunner.query(
      `UPDATE "builder_sessions" s
          SET "lastRunSequence" = COALESCE(
            (SELECT MAX(r."sequence") FROM "builder_build_runs" r WHERE r."sessionId" = s.id),
            0
          )
        WHERE EXISTS (
          SELECT 1 FROM "builder_build_runs" r WHERE r."sessionId" = s.id
        )`,
    );

    await queryRunner.query(
      `ALTER TABLE "builder_settings"
         ADD COLUMN IF NOT EXISTS "maxRunnerMinutes" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP COLUMN IF EXISTS "maxRunnerMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP COLUMN IF EXISTS "lastRunSequence"`,
    );
  }
}
