import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Links a scenario session to the Track 2.0 item progress row it was played
 * for (sits beside the legacy scenarioPathSessionItemId / caseSessionItemId
 * columns). Loose FK → track_item_progress.id.
 */
export class AddTrackItemProgressIdToScenarioSessions1827000000000 implements MigrationInterface {
  name = 'AddTrackItemProgressIdToScenarioSessions1827000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD "trackItemProgressId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_sessions_track_item_progress_id" ON "scenario_sessions" ("trackItemProgressId") WHERE "trackItemProgressId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_scenario_sessions_track_item_progress_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN "trackItemProgressId"`,
    );
  }
}
