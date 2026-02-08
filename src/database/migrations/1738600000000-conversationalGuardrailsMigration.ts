import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationalGuardrailsMigration1738600000000
  implements MigrationInterface
{
  name = 'ConversationalGuardrailsMigration1738600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create conversational_guardrails table
    await queryRunner.query(`
      CREATE TABLE "conversational_guardrails" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "helperDialogue" text NOT NULL,
        "actorDialogue" text NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversational_guardrails" PRIMARY KEY ("id")
      )
    `);

    // Create conversational_guardrails_translations table
    await queryRunner.query(`
      CREATE TABLE "conversational_guardrails_translations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "guardrailId" uuid NOT NULL,
        "languageId" integer NOT NULL,
        "helperDialogue" text NOT NULL,
        "actorDialogue" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversational_guardrails_translations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_guardrail_translation_guardrail" FOREIGN KEY ("guardrailId") 
          REFERENCES "conversational_guardrails"("id") ON DELETE CASCADE
      )
    `);

    // Create unique index for guardrailId + languageId
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_guardrail_language_unique" 
      ON "conversational_guardrails_translations" ("guardrailId", "languageId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_guardrail_language_unique"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "conversational_guardrails_translations"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "conversational_guardrails"`,
    );
  }
}
