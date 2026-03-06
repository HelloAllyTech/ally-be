import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUseDashboardOverrideToPrompts1772650000000 implements MigrationInterface {
  name = 'AddUseDashboardOverrideToPrompts1772650000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD "useDashboardOverride" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN "useDashboardOverride"`,
    );
  }
}
