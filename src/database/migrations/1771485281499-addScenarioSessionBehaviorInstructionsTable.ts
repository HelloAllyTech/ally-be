import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioSessionBehaviorInstructionsTable1771485281499 implements MigrationInterface {
  name = 'AddScenarioSessionBehaviorInstructionsTable1771485281499';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_session_behavior_instructions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" character varying NOT NULL, "scenarioBehaviorInstructionId" character varying NOT NULL, "occurredAt" TIMESTAMP NOT NULL, CONSTRAINT "PK_4e28fa4ba56d04942bffac1b8fa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "sscenario_session_behavior_instructions_scenario_session_id_idx" ON "scenario_session_behavior_instructions" ("scenarioSessionId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."sscenario_session_behavior_instructions_scenario_session_id_idx"`,
    );
    await queryRunner.query(
      `DROP TABLE "scenario_session_behavior_instructions"`,
    );
  }
}
