import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTurnMetricsSource1781200000000 implements MigrationInterface {
  name = 'AddTurnMetricsSource1781200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Add the column (nullable first so existing rows aren't rejected).
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" ADD "source" character varying`,
    );
    // 2) Mark every existing row as 'pipeline' (they were all emitted live by
    //    the agent). Transcript-derived rows will be inserted with 'transcript'.
    await queryRunner.query(
      `UPDATE "scenario_session_turn_metrics" SET "source" = 'pipeline' ` +
        `WHERE "source" IS NULL`,
    );
    // 3) Lock it down: default 'pipeline' for future agent rows + NOT NULL.
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" ` +
        `ALTER COLUMN "source" SET DEFAULT 'pipeline'`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" ` +
        `ALTER COLUMN "source" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_turn_metrics_source_idx" ` +
        `ON "scenario_session_turn_metrics" ("source")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_turn_metrics_source_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_turn_metrics" DROP COLUMN "source"`,
    );
  }
}
