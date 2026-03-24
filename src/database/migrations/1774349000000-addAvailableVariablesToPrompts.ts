import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAvailableVariablesToPrompts1774349000000 implements MigrationInterface {
  name = 'AddAvailableVariablesToPrompts1774349000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD "availableVariables" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN "availableVariables"`,
    );
  }
}
