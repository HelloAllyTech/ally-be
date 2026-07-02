import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeedKeyToCustomFieldDefinition1801000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "seedKey" TEXT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions" DROP COLUMN IF EXISTS "seedKey"`,
    );
  }
}
