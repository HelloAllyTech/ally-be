import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBehaviorInstructionTables1771310678362 implements MigrationInterface {
  name = 'AddBehaviorInstructionTables1771310678362';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_behavior_instructions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioId" integer NOT NULL, "category" character varying NOT NULL, "instructions" text array NOT NULL, "deletedAt" TIMESTAMP, "createdBy" integer, "updatedBy" integer, CONSTRAINT "PK_60d68503fe082dacfabaa9f4335" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_behavior_instructions_scenario_id_idx" ON "scenario_behavior_instructions" ("scenarioId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_behavior_instruction_behaviors" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "behaviorId" uuid NOT NULL, "scenarioBehaviorInstructionId" uuid NOT NULL, CONSTRAINT "PK_07a599a1de555e7b2a8cc707f29" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_behavior_instruction_behaviors_instruction_id_behavior_id_idx" ON "scenario_behavior_instruction_behaviors" ("scenarioBehaviorInstructionId", "behaviorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "behaviors" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "createdBy" integer, CONSTRAINT "PK_dc34a2b981fe38b508ba9957255" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "behaviors"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_behavior_instruction_behaviors_instruction_id_behavior_id_idx"`,
    );
    await queryRunner.query(
      `DROP TABLE "scenario_behavior_instruction_behaviors"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_scenario_behavior_instructions_scenario_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_behavior_instructions"`);
  }
}
