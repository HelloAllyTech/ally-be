import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Attributes a ROLEPLAY_V2 session to the exact roleplay_spec_versions
 * snapshot it ran against (loose FK, no constraint), mirroring what
 * scenarioVersionId does for v1 sessions. Null for all v1 sessions.
 *
 * Note: the ScenarioSessions entity is deliberately NOT extended with this
 * column (the v1 learn module stays untouched); RoleplaySessionService writes
 * it with a raw UPDATE at session start.
 */
export class AddRoleplaySpecVersionToScenarioSessions1816000000000 implements MigrationInterface {
  name = 'AddRoleplaySpecVersionToScenarioSessions1816000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD "roleplaySpecVersionId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_sessions_roleplay_spec_version_id" ON "scenario_sessions" ("roleplaySpecVersionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_scenario_sessions_roleplay_spec_version_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN "roleplaySpecVersionId"`,
    );
  }
}
