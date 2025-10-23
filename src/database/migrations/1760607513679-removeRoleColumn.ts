import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveRoleColumn1760607513679 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "role"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN "role" character varying NOT NULL DEFAULT 'CLIENT'
    `);

    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD CONSTRAINT "CHK_users_role" 
      CHECK (role IN ('CLIENT', 'COUNSELOR', 'SUPER_ADMIN', 'ADMIN', 'LEARNER'))
    `);
  }
}
