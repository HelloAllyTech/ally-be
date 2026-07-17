import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marks each scenarios row with the runtime engine that plays it:
 *  - engine          — 'SIMULATION' (v1, default for every existing row) or
 *                      'ROLEPLAY_V2' (thin shell managed by Roleplay Studio v2).
 *  - roleplaySpecId  — loose FK to roleplay_specs.id for ROLEPLAY_V2 rows.
 *
 * Learner listing/launch keeps reading scenarios unchanged; the engine column
 * is what startScenarioSession branches on to dispatch the v2 agent, and what
 * updateScenario uses to reject v1-studio edits of v2 shells (422).
 */
export class AddEngineToScenarios1815000000000 implements MigrationInterface {
  name = 'AddEngineToScenarios1815000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD "engine" character varying NOT NULL DEFAULT 'SIMULATION'`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD "roleplaySpecId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenarios_roleplay_spec_id" ON "scenarios" ("roleplaySpecId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_scenarios_roleplay_spec_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" DROP COLUMN "roleplaySpecId"`,
    );
    await queryRunner.query(`ALTER TABLE "scenarios" DROP COLUMN "engine"`);
  }
}
