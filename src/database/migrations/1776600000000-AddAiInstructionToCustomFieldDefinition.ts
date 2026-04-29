import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiInstructionToCustomFieldDefinition1776600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "ai_instruction" TEXT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions" DROP COLUMN IF EXISTS "ai_instruction"`,
    );
  }
}
