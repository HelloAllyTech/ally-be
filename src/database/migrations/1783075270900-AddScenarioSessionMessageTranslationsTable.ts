import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioSessionMessageTranslationsTable1783075270900 implements MigrationInterface {
  name = 'AddScenarioSessionMessageTranslationsTable1783075270900';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" DROP CONSTRAINT "FK_competency_behaviors_competency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" DROP CONSTRAINT "FK_competency_behaviors_behavior"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_session_message_translations_message_id_language_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_scenario_versions_scenario_version_number"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_turn_metrics_source_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_competencies_custom_owner_name"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_competency_behaviors_competencyId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" DROP CONSTRAINT "UQ_competency_behaviors_competency_behavior"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_versions" ALTER COLUMN "config" SET DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_feedbacks" ALTER COLUMN "tags" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."conversational_guardrails_kind_enum" RENAME TO "conversational_guardrails_kind_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."conversational_guardrails_kind_enum" AS ENUM('USER', 'SYSTEM')`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" ALTER COLUMN "kind" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" ALTER COLUMN "kind" TYPE "public"."conversational_guardrails_kind_enum" USING "kind"::"text"::"public"."conversational_guardrails_kind_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" ALTER COLUMN "kind" SET DEFAULT 'USER'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."conversational_guardrails_kind_enum_old"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_session_message_translations_message_id_language_id_idx" ON "scenario_session_message_translations" ("scenarioSessionMessageId", "languageId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5fb5f675aea92fde04ce494e46" ON "competency_behaviors" ("competencyId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" ADD CONSTRAINT "UQ_3a4317995433f93adb8d9bb739d" UNIQUE ("competencyId", "behaviorId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" DROP CONSTRAINT "UQ_3a4317995433f93adb8d9bb739d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5fb5f675aea92fde04ce494e46"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_session_message_translations_message_id_language_id_idx"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."conversational_guardrails_kind_enum_old" AS ENUM('USER', 'SYSTEM')`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" ALTER COLUMN "kind" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" ALTER COLUMN "kind" TYPE "public"."conversational_guardrails_kind_enum_old" USING "kind"::"text"::"public"."conversational_guardrails_kind_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversational_guardrails" ALTER COLUMN "kind" SET DEFAULT 'USER'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."conversational_guardrails_kind_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."conversational_guardrails_kind_enum_old" RENAME TO "conversational_guardrails_kind_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_feedbacks" ALTER COLUMN "tags" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_versions" ALTER COLUMN "config" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" ADD CONSTRAINT "UQ_competency_behaviors_competency_behavior" UNIQUE ("competencyId", "behaviorId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_competency_behaviors_competencyId" ON "competency_behaviors" ("competencyId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_competencies_custom_owner_name" ON "competencies" ("name", "createdBy") WHERE ("isCustom" = true)`,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_turn_metrics_source_idx" ON "scenario_session_turn_metrics" ("source") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_scenario_versions_scenario_version_number" ON "scenario_versions" ("scenarioId", "versionNumber") WHERE ("deletedAt" IS NULL)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_session_message_translations_message_id_language_id" ON "scenario_session_message_translations" ("scenarioSessionMessageId", "languageId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" ADD CONSTRAINT "FK_competency_behaviors_behavior" FOREIGN KEY ("behaviorId") REFERENCES "behaviors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "competency_behaviors" ADD CONSTRAINT "FK_competency_behaviors_competency" FOREIGN KEY ("competencyId") REFERENCES "competencies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
