import { MigrationInterface, QueryRunner } from 'typeorm';

export class addGuardrailsTable1770639210761 implements MigrationInterface {
  name = 'addGuardrailsTable1770639210761';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "conversational_guardrails" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL DEFAULT '', "helperDialogue" character varying NOT NULL, "actorDialogue" character varying NOT NULL, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_56659411fb20c342ec740fe8e9f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "conversational_guardrails_translations" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "guardrailId" character varying NOT NULL, "languageId" integer NOT NULL, "helperDialogue" character varying NOT NULL, "actorDialogue" character varying NOT NULL, CONSTRAINT "PK_52729a61bba78e48a680fec28f5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_conversational_guard_translations_guard_id_lang_id_idx" ON "conversational_guardrails_translations" ("guardrailId", "languageId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_conversational_guard_translations_guard_id_lang_id_idx"`,
    );
    await queryRunner.query(
      `DROP TABLE "conversational_guardrails_translations"`,
    );
    await queryRunner.query(`DROP TABLE "conversational_guardrails"`);
  }
}
