import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What automated review and fixes cost per pull request, and the per-PR limit
 * that hands a pull request to a person once it is spent. The fix-round
 * default drops from 3 to 2: a round is ~40 minutes of review and opencode,
 * and three of them kept a loop going for hours.
 */
export class BuilderAutomationSpend1978000000000 implements MigrationInterface {
  name = 'BuilderAutomationSpend1978000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "automationCostUsd" numeric(10,4) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "maxPrAutomationUsd" numeric(10,2) DEFAULT 10`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_settings" ALTER COLUMN "maxFixRunsPerPr" SET DEFAULT 2`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" ALTER COLUMN "maxFixRunsPerPr" SET DEFAULT 3`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP COLUMN IF EXISTS "maxPrAutomationUsd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "automationCostUsd"`,
    );
  }
}
