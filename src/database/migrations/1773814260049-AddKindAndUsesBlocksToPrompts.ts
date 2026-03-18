import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKindAndUsesBlocksToPrompts1773814260049 implements MigrationInterface {
  name = 'AddKindAndUsesBlocksToPrompts1773814260049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD "kind" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "prompts" ADD "usesBlocks" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prompts" DROP COLUMN "usesBlocks"`);
    await queryRunner.query(`ALTER TABLE "prompts" DROP COLUMN "kind"`);
  }
}
