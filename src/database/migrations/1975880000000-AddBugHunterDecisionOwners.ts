import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-point decision ownership for Bug Hunter's orchestrator (OPP-0783).
 *
 * `bug_hunter_settings.decision_owners` is a jsonb map from a decision point
 * (D1..D8) to 'rule' or 'model'. Null, or a point absent from the map, means
 * the default in `BUG_HUNTER_DECISION_OWNER_DEFAULTS`. Only an admin writes
 * it (PATCH /v1/bug-hunter/decisions/owners), typically after the replay
 * report says a shadow has beaten the owner often enough to flip. D4 and D8
 * are fixed in code and ignore the map.
 *
 * On the singleton settings row rather than its own table because it is
 * one small map read on every decision and changed a few times a quarter.
 */
export class AddBugHunterDecisionOwners1975880000000 implements MigrationInterface {
  name = 'AddBugHunterDecisionOwners1975880000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunter_settings" ADD COLUMN IF NOT EXISTS "decision_owners" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunter_settings" DROP COLUMN IF EXISTS "decision_owners"`,
    );
  }
}
