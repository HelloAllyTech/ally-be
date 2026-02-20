import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioSessionReflectionPromptResponse1771472637824 implements MigrationInterface {
  name = 'AddScenarioSessionReflectionPromptResponse1771472637824';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_session_reflection_prompt_response" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" character varying NOT NULL, "promptId" uuid NOT NULL, "response" text, CONSTRAINT "PK_556083eb840186b3f8c96a5015e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_session_reflection_prompt_response_idx" ON "scenario_session_reflection_prompt_response" ("scenarioSessionId", "promptId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_session_reflection_prompt_response_idx"`,
    );
    await queryRunner.query(
      `DROP TABLE "scenario_session_reflection_prompt_response"`,
    );
  }
}
