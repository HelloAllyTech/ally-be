import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateTimeAndScoreWindowInEvents1770010562414 implements MigrationInterface {
  name = 'UpdateTimeAndScoreWindowInEvents1770010562414';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove startTime and endTime from session_events where detectionType = 'TIME'
    await queryRunner.query(`
      UPDATE "session_events"
      SET "detectionConfig" = "detectionConfig" - 'startTime' - 'endTime'
      WHERE "detectionType" = 'TIME'
        AND "detectionConfig" IS NOT NULL
    `);

    // Remove startTime and endTime from scenario_events where linked session_events has detectionType = 'TIME'
    await queryRunner.query(`
      UPDATE "scenario_events" se
      SET "detectionConfig" = se."detectionConfig" - 'startTime' - 'endTime'
      FROM "session_events" sess
      WHERE se."eventId" = sess."id"
        AND sess."detectionType" = 'TIME'
        AND se."detectionConfig" IS NOT NULL
    `);

    // Remove minScore and maxScore from session_events where detectionType = 'SCORE'
    await queryRunner.query(`
      UPDATE "session_events"
      SET "detectionConfig" = "detectionConfig" - 'minScore' - 'maxScore'
      WHERE "detectionType" = 'SCORE'
        AND "detectionConfig" IS NOT NULL
    `);

    // Remove minScore and maxScore from scenario_events where linked session_events has detectionType = 'SCORE'
    await queryRunner.query(`
      UPDATE "scenario_events" se
      SET "detectionConfig" = se."detectionConfig" - 'minScore' - 'maxScore'
      FROM "session_events" sess
      WHERE se."eventId" = sess."id"
        AND sess."detectionType" = 'SCORE'
        AND se."detectionConfig" IS NOT NULL
    `);
  }

  public async down(): Promise<void> {
    console.warn(
      'This migration removes data from detectionConfig JSONB column and cannot be reversed.',
    );
  }
}
