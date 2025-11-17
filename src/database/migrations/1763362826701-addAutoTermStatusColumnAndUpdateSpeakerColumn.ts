import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutoTermStatusColumnAndUpdateSpeakerColumn1763362826701
  implements MigrationInterface
{
  name = 'AddAutoTermStatusColumnAndUpdateSpeakerColumn1763362826701';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Migrate speaker column value into detectionData before dropping the column
    // If detectionData is NULL, create a new JSONB object with speaker
    // If detectionData exists, merge speaker into it while preserving existing data
    await queryRunner.query(`
      UPDATE "session_events"
      SET "detectionData" = 
        CASE 
          WHEN "detectionData" IS NULL THEN
            jsonb_build_object('speaker', "speaker")
          ELSE
            "detectionData" || jsonb_build_object('speaker', "speaker")
        END
      WHERE "speaker" IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "speaker"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "autoTerminationStatus" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "autoTerminationStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "speaker" character varying NOT NULL DEFAULT 'CARE_GIVER'`,
    );

    // Extract speaker from detectionData and update the speaker column
    // Remove speaker from detectionData after extraction
    await queryRunner.query(`
      UPDATE "session_events"
      SET 
        "speaker" = COALESCE("detectionData"->>'speaker', 'CARE_GIVER'),
        "detectionData" = "detectionData" - 'speaker'
      WHERE "detectionData" IS NOT NULL 
        AND "detectionData"->>'speaker' IS NOT NULL
    `);

    // For rows where detectionData is NULL or doesn't have speaker, keep the default
    // The default value 'CARE_GIVER' is already set by the column definition
  }
}
