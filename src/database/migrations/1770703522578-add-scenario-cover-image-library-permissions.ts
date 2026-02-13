import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioCoverImageLibraryPermissions1770703522578 implements MigrationInterface {
  name = 'AddScenarioCoverImageLibraryPermissions1770703522578';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES
        ('view:scenario-cover-image-library'),
        ('edit:scenario-cover-image-library'),
        ('delete:scenario-cover-image-library')
    `);
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g.id, p.id
      FROM "groups" g, "permissions" p
      WHERE g.name IN ('SUPER_ADMIN')
      AND p.name IN ('view:scenario-cover-image-library', 'edit:scenario-cover-image-library', 'delete:scenario-cover-image-library')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT id FROM "permissions" WHERE name IN ('view:scenario-cover-image-library', 'edit:scenario-cover-image-library', 'delete:scenario-cover-image-library')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE name IN ('view:scenario-cover-image-library', 'edit:scenario-cover-image-library', 'delete:scenario-cover-image-library')
    `);
  }
}
