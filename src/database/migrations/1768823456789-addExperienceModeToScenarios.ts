import { ExperienceMode } from 'src/learn/type/scenario.type';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExperienceModeToScenarios1768823456789 implements MigrationInterface {
  name = 'AddExperienceModeToScenarios1768823456789';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Set default values for experienceMode in metadata
    await queryRunner.query(
      `UPDATE "scenarios" SET "metadata" = jsonb_set(
        COALESCE("metadata", '{}'::jsonb),
        '{experienceMode}',
        '"${ExperienceMode.FEEDBACK}"'
      ) WHERE "metadata" IS NULL OR "metadata" ->> 'experienceMode' IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove experienceMode from metadata
    await queryRunner.query(
      `UPDATE "scenarios" SET "metadata" = "metadata" - 'experienceMode' WHERE "metadata" IS NOT NULL`,
    );
  }
}
