import { UserRole } from 'src/common/constants/user.constants';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddComfortAudioLibraryPermissions1823000000001
  implements MigrationInterface
{
  name = 'AddComfortAudioLibraryPermissions1823000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES
        ('view:comfort-audio-library'),
        ('edit:comfort-audio-library'),
        ('delete:comfort-audio-library')
    `);
    // Superadmins can manage (view/edit/delete) the shared library.
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g.id, p.id
      FROM "groups" g, "permissions" p
      WHERE g.name IN ('SUPER_ADMIN')
      AND p.name IN ('view:comfort-audio-library', 'edit:comfort-audio-library', 'delete:comfort-audio-library')
    `);
    // Multi-tenant admins (scenario authors) can view the library to pick a track.
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('view:comfort-audio-library')
      WHERE g."name" = '${UserRole.MULTI_TENANT_ADMIN}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT id FROM "permissions" WHERE name IN ('view:comfort-audio-library', 'edit:comfort-audio-library', 'delete:comfort-audio-library')
      )
    `);
    await queryRunner.query(`
      DELETE FROM "permissions" WHERE name IN ('view:comfort-audio-library', 'edit:comfort-audio-library', 'delete:comfort-audio-library')
    `);
  }
}
