import { MigrationInterface, QueryRunner } from 'typeorm';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';

export class AddInitialPermissionData1745473519846
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permission of Object.values(PERMISSIONS)) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name") VALUES ($1)`,
        [permission],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const permission of Object.values(PERMISSIONS)) {
      await queryRunner.query(`DELETE FROM "permissions" WHERE "name" = $1`, [
        permission,
      ]);
    }
  }
}
