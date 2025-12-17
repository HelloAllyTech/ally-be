import { MigrationInterface, QueryRunner } from 'typeorm';

export class LanguageTranslationsTable1765966044770
  implements MigrationInterface
{
  name = 'LanguageTranslationsTable1765966044770';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_preferences" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "data" jsonb NOT NULL DEFAULT '{"default_language_id": 1}', CONSTRAINT "PK_e8cfb5b31af61cd363a6b6d7c25" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_user_preferences_user_id_idx" ON "user_preferences" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "session_events_translations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionEventId" character varying NOT NULL, "languageId" integer NOT NULL, "message" character varying, "branchInstruction" character varying, "detectionData" jsonb, CONSTRAINT "PK_026017320965bd486378df6d201" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_session_events_translations_sessionEventId_languageId_idx" ON "session_events_translations" ("sessionEventId", "languageId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_translations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioId" integer NOT NULL, "languageId" integer NOT NULL, "metadata" jsonb, CONSTRAINT "PK_87cb6e92eefaeb6c34b94c46eb3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_translations_scenarioId_languageId_idx" ON "scenario_translations" ("scenarioId", "languageId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_events_translations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioId" integer NOT NULL, "eventId" character varying NOT NULL, "languageId" integer NOT NULL, "message" character varying, "branchInstruction" character varying, CONSTRAINT "PK_5e938bc487865a52a749d171056" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_events_translations_scenarioId_eventId_languageId_idx" ON "scenario_events_translations" ("scenarioId", "eventId", "languageId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "languages" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "value" character varying NOT NULL, "label" character varying NOT NULL, "active" boolean NOT NULL DEFAULT true, "translationCode" character varying NOT NULL DEFAULT '', CONSTRAINT "PK_b517f827ca496b29f4d549c631d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_languages_value_idx" ON "languages" ("value") `,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_voices" ADD "languageId" integer NOT NULL DEFAULT '1'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_voices" DROP COLUMN "languageId"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_languages_value_idx"`);
    await queryRunner.query(`DROP TABLE "languages"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_events_translations_scenarioId_eventId_languageId_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_events_translations"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_translations_scenarioId_languageId_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_translations"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_session_events_translations_sessionEventId_languageId_idx"`,
    );
    await queryRunner.query(`DROP TABLE "session_events_translations"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_user_preferences_user_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "user_preferences"`);
  }
}
