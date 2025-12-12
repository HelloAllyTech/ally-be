import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScenarioTranslationsTable1765446838000
  implements MigrationInterface
{
  name = 'CreateScenarioTranslationsTable1765446838000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "scenario_translations" (
        "id" SERIAL NOT NULL,
        "scenarioId" INTEGER NOT NULL,
        "languageId" INTEGER NOT NULL,
        "metadata" JSONB,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scenario_translations_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_scenario_translations_scenario_language" UNIQUE ("scenarioId", "languageId")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_scenario_translations_scenario_id" ON "scenario_translations" ("scenarioId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_translations_language_id" ON "scenario_translations" ("languageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_scenario_translations_language_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "idx_scenario_translations_scenario_id"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_translations"`);
  }
}
