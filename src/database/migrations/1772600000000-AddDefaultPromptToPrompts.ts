import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDefaultPromptToPrompts1772600000000 implements MigrationInterface {
  name = 'AddDefaultPromptToPrompts1772600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "prompts" ADD "defaultPrompt" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN "defaultPrompt"`,
    );
  }
}
