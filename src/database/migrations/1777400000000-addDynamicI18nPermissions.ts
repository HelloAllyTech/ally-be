import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDynamicI18nPermissions1777400000000 implements MigrationInterface {
  private readonly permissionNames = [
    'view:admin:i18n-translations',
    'edit:admin:i18n-translations',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of this.permissionNames) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name")
         SELECT $1::varchar
         WHERE NOT EXISTS (
           SELECT 1 FROM "permissions" WHERE "name" = $1::varchar
         )`,
        [name],
      );
    }

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      CROSS JOIN "permissions" p
      WHERE g."name" = 'SUPER_ADMIN'
        AND p."name" IN (
          'view:admin:i18n-translations',
          'edit:admin:i18n-translations'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "group_permissions" gp
          WHERE gp."groupId" = g."id"
            AND gp."permissionId" = p."id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id"
        FROM "permissions"
        WHERE "name" IN (
          'view:admin:i18n-translations',
          'edit:admin:i18n-translations'
        )
      )
    `);

    for (const name of this.permissionNames) {
      await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = $1`, [
        name,
      ]);
    }
  }
}
