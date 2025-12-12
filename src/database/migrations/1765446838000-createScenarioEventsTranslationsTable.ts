import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScenarioEventsTranslationsTable1765446838000
  implements MigrationInterface
{
  name = 'CreateScenarioEventsTranslationsTable1765446838000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "scenario_events_translations" (
        "id" SERIAL NOT NULL,
        "scenarioId" INTEGER NOT NULL,
        "eventId" VARCHAR NOT NULL,
        "languageId" INTEGER NOT NULL,
        "message" VARCHAR,
        "branchInstruction" VARCHAR,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scenario_events_translations_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_scenario_event_lang" UNIQUE ("scenarioId", "eventId", "languageId")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_scenario_events_translations_scenario_id" ON "scenario_events_translations" ("scenarioId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_events_translations_event_id" ON "scenario_events_translations" ("eventId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_events_translations_language_id" ON "scenario_events_translations" ("languageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_scenario_events_translations_language_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_scenario_events_translations_event_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_scenario_events_translations_scenario_id"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_events_translations"`);
  }
}
