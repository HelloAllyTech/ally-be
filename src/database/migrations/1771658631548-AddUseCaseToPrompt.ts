import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUseCaseToPrompt1771658631548 implements MigrationInterface {
  name = 'AddUseCaseToPrompt1771658631548';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD "useCase" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prompts" DROP COLUMN "useCase"`);
  }
}
