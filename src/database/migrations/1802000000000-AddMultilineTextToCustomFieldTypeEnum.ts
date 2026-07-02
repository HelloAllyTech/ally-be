import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMultilineTextToCustomFieldTypeEnum1802000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "custom_field_type_enum" ADD VALUE IF NOT EXISTS 'MULTILINE_TEXT'`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing individual enum values without recreating the type
  }
}
