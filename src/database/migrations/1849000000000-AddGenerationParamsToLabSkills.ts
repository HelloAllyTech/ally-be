import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds optional per-skill generation parameters to lab_skills:
 * - `temperature` — sampling temperature (only sent for models that support it)
 * - `max_tokens`  — output token cap for the run
 * - `system_prompt` — an optional system message sent alongside the resolved
 *   prompt (the prompt template itself stays in `content`)
 * All nullable: null means "use the AI Lab default" for that parameter.
 */
export class AddGenerationParamsToLabSkills1849000000000 implements MigrationInterface {
  name = 'AddGenerationParamsToLabSkills1849000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_skills" ADD COLUMN "temperature" double precision`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_skills" ADD COLUMN "max_tokens" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_skills" ADD COLUMN "system_prompt" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "lab_skills" DROP COLUMN "system_prompt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_skills" DROP COLUMN "max_tokens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "lab_skills" DROP COLUMN "temperature"`,
    );
  }
}
