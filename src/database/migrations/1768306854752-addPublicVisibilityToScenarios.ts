import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPublicVisibilityToScenarios1768306854752 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scenarios 
      SET "isPublic" = true 
      WHERE "isPublic" IS NULL OR "isPublic" = false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scenarios 
      SET "isPublic" = false
    `);
  }
}
