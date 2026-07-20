import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds token-usage and cost columns to lab_runs so a completed run records how
 * many tokens it consumed and an estimated USD cost (derived from a per-model
 * pricing table at run time). All nullable: older rows and runs whose provider
 * did not report usage simply leave them null.
 */
export class AddTokenUsageToLabRuns1850000000000 implements MigrationInterface {
  name = 'AddTokenUsageToLabRuns1850000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD COLUMN "prompt_tokens" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD COLUMN "completion_tokens" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD COLUMN "total_tokens" integer`,
    );
    // numeric(12,6): fractions of a cent are meaningful at per-run granularity.
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD COLUMN "cost_usd" numeric(12,6)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lab_runs" DROP COLUMN "cost_usd"`);
    await queryRunner.query(
      `ALTER TABLE "lab_runs" DROP COLUMN "total_tokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_runs" DROP COLUMN "completion_tokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_runs" DROP COLUMN "prompt_tokens"`,
    );
  }
}
