import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsObsoleteToPrompts1773123208523 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD "isObsolete" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prompts" DROP COLUMN "isObsolete"`);
  }
}
