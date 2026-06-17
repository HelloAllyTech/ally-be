import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Denormalizes the session rollup (computed by the judge's code rule) onto
 * every turn row, so the dashboard can compute drift RATE with a simple
 * COUNT(DISTINCT session) FILTER (WHERE "sessionDrifted") instead of
 * re-deriving the consecutive-run logic in SQL.
 */
export class AddDriftSessionRollupColumns1781800000000 implements MigrationInterface {
  name = 'AddDriftSessionRollupColumns1781800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "turn_drift_judgment" ADD COLUMN IF NOT EXISTS "sessionDrifted" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "turn_drift_judgment" ADD COLUMN IF NOT EXISTS "firstDriftTurn" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "turn_drift_judgment" DROP COLUMN IF EXISTS "firstDriftTurn"`,
    );
    await queryRunner.query(
      `ALTER TABLE "turn_drift_judgment" DROP COLUMN IF EXISTS "sessionDrifted"`,
    );
  }
}
