import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSystemToCustomFieldFillModeEnum1805000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "custom_field_fill_mode_enum" ADD VALUE IF NOT EXISTS 'SYSTEM'`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing individual enum values without recreating the type
  }
}
