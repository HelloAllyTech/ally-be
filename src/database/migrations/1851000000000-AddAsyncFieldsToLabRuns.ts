import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports asynchronous AI Lab run execution: adds `generation_params` (a
 * jsonb snapshot of temperature/max_tokens/system_prompt taken at enqueue time
 * so a queued run can execute without re-reading a possibly-edited skill). The
 * new PENDING status reuses the existing varchar `status` column, so no schema
 * change is needed for it.
 */
export class AddAsyncFieldsToLabRuns1851000000000 implements MigrationInterface {
  name = 'AddAsyncFieldsToLabRuns1851000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_runs" ADD COLUMN "generation_params" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_runs" DROP COLUMN "generation_params"`,
    );
  }
}
