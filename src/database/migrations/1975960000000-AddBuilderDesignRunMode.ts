import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Let a run be a technical design.
 *
 * A DESIGN run is a read-only opencode pass on the runner that checks every
 * target repo out and writes the technical design the build is then held to.
 * It exists because session 880e73e6 (2026-10-12) shipped a PRD whose
 * technical plan — written by the in-process interviewer with no code in front
 * of it — renamed a persisted JSON key with a migration, breaking every
 * released mobile client that read the old one.
 *
 * `builder_build_runs.mode` is a varchar with a CHECK, and the REVIEW mode
 * already failed in production once because the enum moved and the constraint
 * did not (1970800000000). Extended here in the same change as the enum.
 */
export class AddBuilderDesignRunMode1975960000000 implements MigrationInterface {
  name = 'AddBuilderDesignRunMode1975960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP CONSTRAINT IF EXISTS "CHK_builder_build_runs_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs"
         ADD CONSTRAINT "CHK_builder_build_runs_mode"
         CHECK ("mode" IN ('build', 'resume', 'fix', 'review', 'design'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Any design run would fail the narrower CHECK on the way back down. The
    // design itself lives in the PRD draft, not on the run, so nothing a
    // person approved is lost with these rows.
    await queryRunner.query(
      `DELETE FROM "builder_build_runs" WHERE "mode" = 'design'`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs" DROP CONSTRAINT IF EXISTS "CHK_builder_build_runs_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_build_runs"
         ADD CONSTRAINT "CHK_builder_build_runs_mode"
         CHECK ("mode" IN ('build', 'resume', 'fix', 'review'))`,
    );
  }
}
