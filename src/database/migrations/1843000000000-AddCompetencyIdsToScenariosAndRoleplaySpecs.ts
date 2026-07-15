import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roleplay Studio v2 first-class multi-competency: a spec/scenario can now be
 * tagged against several competencies. `competencyIds` (jsonb array of uuid
 * strings) is added alongside the existing scalar `competencyId`, which stays
 * in sync as competencyIds[0]. Backfill seeds the array from the scalar so
 * existing rows read consistently.
 */
export class AddCompetencyIdsToScenariosAndRoleplaySpecs1843000000000 implements MigrationInterface {
  name = 'AddCompetencyIdsToScenariosAndRoleplaySpecs1843000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD "competencyIds" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "roleplay_specs" ADD "competencyIds" jsonb`,
    );
    // Backfill from the scalar where one exists.
    await queryRunner.query(
      `UPDATE "scenarios" SET "competencyIds" = jsonb_build_array("competencyId") WHERE "competencyId" IS NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "roleplay_specs" SET "competencyIds" = jsonb_build_array("competencyId") WHERE "competencyId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roleplay_specs" DROP COLUMN "competencyIds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" DROP COLUMN "competencyIds"`,
    );
  }
}
