import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserPreferencesSessionEvents1766129656910
  implements MigrationInterface
{
  name = 'UserPreferencesSessionEvents1766129656910';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_events_translations_scenario_id_event_id_language_i"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events_translations" ADD "name" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_preferences" ALTER COLUMN "data" DROP DEFAULT`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_events_translations_scenario_id_event_id_lang_id_idx" ON "scenario_events_translations" ("scenarioId", "eventId", "languageId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_events_translations_scenario_id_event_id_lang_id_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_preferences" ALTER COLUMN "data" SET DEFAULT '{"default_language_id": 1}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events_translations" DROP COLUMN "name"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_events_translations_scenario_id_event_id_language_i" ON "scenario_events_translations" ("scenarioId", "eventId", "languageId") `,
    );
  }
}
