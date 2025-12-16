import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterSessionEventsTranslationsSequence1765447561001
  implements MigrationInterface
{
  name = 'AlterSessionEventsTranslationsSequence1765447561001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop table if it exists (safe for fresh/local DBs)
    await queryRunner.query(`
      DROP TABLE IF EXISTS "session_events_translations"
    `);

    // Recreate table with SERIAL id
    await queryRunner.query(`
      CREATE TABLE "session_events_translations" (
        "id" SERIAL NOT NULL,
        "sessionEventId" VARCHAR NOT NULL,
        "languageId" INTEGER NOT NULL,
        "message" VARCHAR,
        "branchInstruction" VARCHAR,
        "detectionData" JSONB,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_session_events_translations_id"
          PRIMARY KEY ("id", "sessionEventId"),
        CONSTRAINT "UQ_session_event_lang"
          UNIQUE ("sessionEventId", "languageId")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_session_events_translations_session_event_id"
      ON "session_events_translations" ("sessionEventId")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_session_events_translations_language_id"
      ON "session_events_translations" ("languageId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "session_events_translations"
    `);
  }
}
