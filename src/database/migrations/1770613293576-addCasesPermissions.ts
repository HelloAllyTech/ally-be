import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCasesPermissions1770613293576 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
          INSERT INTO "permissions" ("name") VALUES 
            ('view:admin:cases'),
            ('view:admin:case'),
            ('edit:admin:case'),
            ('delete:admin:case'),
            ('edit:case-tenant'),
            ('view:cases'),
            ('view:case'),
            ('edit:case'),
            ('delete:case-tenant')
        `);

    await queryRunner.query(`
          INSERT INTO "group_permissions" ("groupId", "permissionId")
          SELECT g.id, p.id
          FROM "groups" g, "permissions" p
          WHERE g.name = 'SUPER_ADMIN'
          AND p.name IN (
            'view:admin:cases', 
            'view:admin:case', 
            'edit:admin:case', 
            'delete:admin:case', 
            'edit:case-tenant', 
            'delete:case-tenant'
          )
        `);

    await queryRunner.query(`
          INSERT INTO "group_permissions" ("groupId", "permissionId")
          SELECT g.id, p.id
          FROM "groups" g, "permissions" p
          WHERE g.name = 'LEARNER'
          AND p.name IN ('view:cases', 'view:case', 'edit:case')
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
          DELETE FROM "group_permissions" 
          WHERE "permissionId" IN (
            SELECT id FROM "permissions" 
            WHERE name IN (
              'view:admin:cases',
              'view:admin:case',
              'edit:admin:case',
              'delete:admin:case',
              'edit:case-tenant',
              'view:cases',
              'view:case',
              'edit:case',
              'delete:case-tenant'
            )
          )
        `);

    await queryRunner.query(`
          DELETE FROM "permissions" 
          WHERE name IN (
            'view:admin:cases',
            'view:admin:case',
            'edit:admin:case',
            'delete:admin:case',
            'edit:case-tenant',
            'view:cases',
            'view:case',
            'edit:case',
            'delete:case-tenant'
          )
        `);
  }
}
