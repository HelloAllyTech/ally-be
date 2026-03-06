import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveUseCaseFromPrompts1772700000000 implements MigrationInterface {
  name = 'RemoveUseCaseFromPrompts1772700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prompts" DROP COLUMN "useCase"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD "useCase" character varying`,
    );
  }
}
