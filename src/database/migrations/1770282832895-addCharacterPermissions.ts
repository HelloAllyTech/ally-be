import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCharacterPermissions1770282832895 implements MigrationInterface {
  name = 'AddCharacterPermissions1770282832895';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES
        ('view:scenario-character'),
        ('edit:scenario-character'),
        ('delete:scenario-character'),
        ('create:scenario-character')
    `);
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g.id, p.id
      FROM "groups" g, "permissions" p
      WHERE g.name IN ('SUPER_ADMIN')
      AND p.name IN ('view:scenario-character', 'edit:scenario-character', 'delete:scenario-character', 'create:scenario-character')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT id FROM "permissions" WHERE name IN ('view:scenario-character', 'edit:scenario-character', 'delete:scenario-character', 'create:scenario-character')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE name IN ('view:scenario-character', 'edit:scenario-character', 'delete:scenario-character', 'create:scenario-character')
    `);
  }
}
