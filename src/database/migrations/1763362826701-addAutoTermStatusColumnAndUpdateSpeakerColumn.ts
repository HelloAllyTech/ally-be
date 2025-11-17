import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutoTermStatusColumnAndUpdateSpeakerColumn1763362826701
  implements MigrationInterface
{
  name = 'AddAutoTermStatusColumnAndUpdateSpeakerColumn1763362826701';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

    await queryRunner.query(`
      UPDATE "session_events"
      SET 
        "speaker" = COALESCE("detectionData"->>'speaker', 'CARE_GIVER'),
        "detectionData" = "detectionData" - 'speaker'
      WHERE "detectionData" IS NOT NULL 
        AND "detectionData"->>'speaker' IS NOT NULL
    `);
  }
}
