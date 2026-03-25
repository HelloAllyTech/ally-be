import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryToPrompts1774441000000 implements MigrationInterface {
  name = 'AddCategoryToPrompts1774441000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD "category" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prompts" DROP COLUMN "category"`);
  }
}
