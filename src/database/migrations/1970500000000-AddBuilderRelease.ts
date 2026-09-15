import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Builder releases the pull requests it merged, and watches what happens.
 *
 * All additive and all nullable or defaulted, so an ally-be that has not
 * shipped the feature reads every row as "nothing dispatched, release off".
 *
 * `releaseState` is a varchar with no CHECK, unlike `builder_sessions.currentStage`.
 * The values are written by one service and read by one UI, the set is likely
 * to grow (a `skipped` for unreleasable repos is already foreseeable), and a
 * constraint here would buy nothing that the entity's own type does not already
 * give the only writer.
 */
export class AddBuilderRelease1970500000000 implements MigrationInterface {
  name = 'AddBuilderRelease1970500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "releaseState" character varying(12)`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "releaseTag" character varying(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "releaseRunId" character varying(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "releaseRunUrl" character varying(300)`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "releaseDispatchedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "autoReleaseEnabled" boolean NOT NULL DEFAULT false`,
    );

    // The reconcile pass looks for in-flight releases on every tick, and there
    // is exactly one interesting row in a table that only grows.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_builder_prs_release_state"
         ON "builder_pull_requests" ("releaseState")
         WHERE "releaseState" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_builder_prs_release_state"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP COLUMN IF EXISTS "autoReleaseEnabled"`,
    );
    for (const column of [
      'releaseDispatchedAt',
      'releaseRunUrl',
      'releaseRunId',
      'releaseTag',
      'releaseState',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
