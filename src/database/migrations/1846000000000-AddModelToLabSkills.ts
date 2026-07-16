import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the optional `model` column to lab_skills: the LLM model id (from the
 * LLM model registry) a skill runs on. Null → the AI Lab default (Anthropic
 * autofill model) is used at run time.
 */
export class AddModelToLabSkills1846000000000 implements MigrationInterface {
  name = 'AddModelToLabSkills1846000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_skills" ADD COLUMN "model" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "lab_skills" DROP COLUMN "model"`);
  }
}
