import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The independent finding verifier's run (OPP-0780): `bug_hunt_runs.trigger`
 * of `verify_findings` — one run per closed sweep, on the other vendor's
 * model, confirming or refuting every unproven finding the sweep kept.
 * Same shape as `1975840000000` (verify_fix): the CHECK constraint is the
 * enum's database half.
 */
export class AddVerifyFindingsRunTrigger1975850000000 implements MigrationInterface {
  name = 'AddVerifyFindingsRunTrigger1975850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_trigger"
         CHECK ("trigger" IN ('scheduled', 'manual', 'fix_session', 'verify_fix', 'verify_findings'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "bug_hunt_runs" WHERE "trigger" = 'verify_findings'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" DROP CONSTRAINT IF EXISTS "CHK_bug_hunt_runs_trigger"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_runs" ADD CONSTRAINT "CHK_bug_hunt_runs_trigger"
         CHECK ("trigger" IN ('scheduled', 'manual', 'fix_session', 'verify_fix'))`,
    );
  }
}
