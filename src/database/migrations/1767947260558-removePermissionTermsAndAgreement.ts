import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemovePermissionTermsAndAgreement1767947260558
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions" 
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" 
        WHERE "name" = 'require:terms-and-agreement-approval'
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions" 
      WHERE "name" = 'require:terms-and-agreement-approval'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES 
        ('require:terms-and-agreement-approval')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId") 
      SELECT "id", (SELECT "id" FROM "permissions" WHERE "name" = 'require:terms-and-agreement-approval')
      FROM "groups" 
      WHERE "name" IN ('ADMIN', 'LEARNER', 'COUNSELOR')
    `);
  }
}
