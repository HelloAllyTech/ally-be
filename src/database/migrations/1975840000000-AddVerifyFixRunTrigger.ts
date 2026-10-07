import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Verifier's run (OPP-0779): a `bug_hunt_runs.trigger` of `verify_fix`,
 * for the separate, read-only run that checks out a fix PR on a different
 * vendor's model and records a verdict. Same shape as `1899000000000`'s
 * `fix_session`: the CHECK constraint is the enum's database half, and it
 * has to learn the new value or the first verify run fails to insert.
 */
export class AddVerifyFixRunTrigger1975840000000 implements MigrationInterface {
  name = 'AddVerifyFixRunTrigger1975840000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_trigger"
         CHECK ("trigger" IN ('scheduled', 'manual', 'fix_session', 'verify_fix'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "bug_hunt_runs" WHERE "trigger" = 'verify_fix'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_trigger"
         CHECK ("trigger" IN ('scheduled', 'manual', 'fix_session'))`,
    );
  }
}
