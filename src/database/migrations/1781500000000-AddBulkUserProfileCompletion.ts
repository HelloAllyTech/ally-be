import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports admin bulk-user creation: accounts can be created with only an email
 * (name left blank) and a "profile incomplete" flag so the user is prompted to
 * finish their profile on first login.
 *
 * Adds users."profileCompleted" boolean, default true so all existing rows stay
 * "complete"; bulk-created rows are inserted with false.
 */
export class AddBulkUserProfileCompletion1781500000000 implements MigrationInterface {
  name = 'AddBulkUserProfileCompletion1781500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "profileCompleted" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "profileCompleted"`,
    );
  }
}
