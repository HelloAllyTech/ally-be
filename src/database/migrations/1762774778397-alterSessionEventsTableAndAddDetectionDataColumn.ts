import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterSessionEventsTableAndAddDetectionDataColumn1762774778397 implements MigrationInterface {
  name = 'AlterSessionEventsTableAndAddDetectionDataColumn1762774778397';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the detectionData column
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "detectionData" jsonb`,
    );

    // Migrate data from sentences column (text array) to detectionData.sentences
    // Only update rows where sentences is not null and has data
    await queryRunner.query(`
      UPDATE "session_events"
      SET "detectionData" = jsonb_build_object('sentences', to_jsonb("sentences"))
      WHERE "sentences" IS NOT NULL 
        AND array_length("sentences", 1) > 0
    `);

    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "sentences"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add back the sentences column (text array)
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "sentences" text array`,
    );

    // Migrate data from detectionData.sentences back to sentences column
    // Only update rows where detectionData.sentences exists
    await queryRunner.query(`
      UPDATE "session_events"
      SET "sentences" = (
        SELECT ARRAY(
          SELECT jsonb_array_elements_text("detectionData"->'sentences')
        )
      )
      WHERE "detectionData" IS NOT NULL 
        AND "detectionData"->'sentences' IS NOT NULL
        AND jsonb_array_length("detectionData"->'sentences') > 0
    `);

    // Drop the detectionData column
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "detectionData"`,
    );
  }
}
