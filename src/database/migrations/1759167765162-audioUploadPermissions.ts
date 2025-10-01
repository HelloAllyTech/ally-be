import { MigrationInterface, QueryRunner } from 'typeorm';

export class AudioUploadPermissions1759167765162 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert permissions
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES 
        ('view:audio-upload-url'),
        ('cancel:audio-upload'),
        ('delete:chat')
    `);

    // Insert group permissions for ADMIN group
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId") 
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('view:audio-upload-url', 'cancel:audio-upload', 'delete:chat')
      WHERE g."name" = 'ADMIN'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove group permissions first (due to foreign key constraints)
    await queryRunner.query(`
      DELETE FROM "group_permissions" 
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" 
        WHERE "name" IN ('view:audio-upload-url', 'cancel:audio-upload', 'delete:chat')
      )
    `);

    // Remove permissions
    await queryRunner.query(`
      DELETE FROM "permissions" 
      WHERE "name" IN ('view:audio-upload-url', 'cancel:audio-upload', 'delete:chat')
    `);
  }
}
