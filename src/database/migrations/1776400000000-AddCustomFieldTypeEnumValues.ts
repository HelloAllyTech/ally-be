import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomFieldTypeEnumValues1776400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "custom_field_type_enum" ADD VALUE IF NOT EXISTS 'TEXT'`,
    );
    await queryRunner.query(
      `ALTER TYPE "custom_field_type_enum" ADD VALUE IF NOT EXISTS 'NUMBER'`,
    );
    await queryRunner.query(
      `ALTER TYPE "custom_field_type_enum" ADD VALUE IF NOT EXISTS 'MULTI_SELECT'`,
    );
    await queryRunner.query(
      `ALTER TYPE "custom_field_type_enum" ADD VALUE IF NOT EXISTS 'BOOLEAN'`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing individual enum values without recreating the type
  }
}
