import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `builder_build_runs.prdVersion`: the PRD version a run was dispatched from.
 *
 * A new build from a different PRD version starts its own branch rather than
 * resuming the last run's work, which was written against a PRD that has
 * since changed. Nullable: earlier runs recorded none, and they keep resuming
 * exactly as before.
 */
export class AddBuilderRunPrdVersion1975950000000 implements MigrationInterface {
  name = 'AddBuilderRunPrdVersion1975950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" ADD COLUMN IF NOT EXISTS "prdVersion" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP COLUMN IF EXISTS "prdVersion"`,
    );
  }
}
