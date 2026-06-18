import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migrations1782000000000 implements MigrationInterface {
  name = 'Migrations1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Pause/resume bookkeeping for scenario sessions. `pausedAt` is the start
    // of the currently-open pause (null when running); `totalPausedMs` is the
    // cumulative paused time excluded from billed/limited duration.
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD "pausedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD "totalPausedMs" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN "totalPausedMs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN "pausedAt"`,
    );
  }
}
