import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioSessionMessageTranslationsTable1783075270900 implements MigrationInterface {
  name = 'AddScenarioSessionMessageTranslationsTable1783075270900';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_session_message_translations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionMessageId" integer NOT NULL, "languageId" integer NOT NULL, "content" text NOT NULL, CONSTRAINT "PK_scenario_session_message_translations_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_session_message_translations_message_id_language_id_idx" ON "scenario_session_message_translations" ("scenarioSessionMessageId", "languageId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_session_message_translations_message_id_language_id_idx"`,
    );
    await queryRunner.query(
      `DROP TABLE "scenario_session_message_translations"`,
    );
  }
}
