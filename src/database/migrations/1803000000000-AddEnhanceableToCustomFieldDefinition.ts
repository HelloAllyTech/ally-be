import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnhanceableToCustomFieldDefinition1803000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions"
       ADD COLUMN IF NOT EXISTS "enhanceable" BOOLEAN NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions" DROP COLUMN IF EXISTS "enhanceable"`,
    );
  }
}
