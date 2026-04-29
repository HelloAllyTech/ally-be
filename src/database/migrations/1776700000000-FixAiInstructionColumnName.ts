import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixAiInstructionColumnName1776700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions" DROP COLUMN IF EXISTS "ai_instruction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions" ADD COLUMN IF NOT EXISTS "aiInstruction" TEXT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "custom_field_definitions" DROP COLUMN IF EXISTS "aiInstruction"`,
    );
  }
}
