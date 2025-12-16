import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueConstraintToUserPreferences1765723500000
  implements MigrationInterface
{
  name = 'AddUniqueConstraintToUserPreferences1765723500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the unique constraint
    await queryRunner.query(`
      ALTER TABLE "user_preferences"
      ADD CONSTRAINT "user_preferences_userId_unique" UNIQUE ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_preferences"
      DROP CONSTRAINT IF EXISTS "user_preferences_userId_unique"
    `);
  }
}
