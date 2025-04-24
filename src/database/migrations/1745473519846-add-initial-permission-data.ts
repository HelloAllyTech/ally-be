import { MigrationInterface, QueryRunner } from 'typeorm';
import { PERMISSIONS } from '../../common/constants/auth.constants';

export class AddInitialPermissionData1745473519846
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permission of PERMISSIONS) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("permission") VALUES ($1)`,
        [permission],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const permission of PERMISSIONS) {
      await queryRunner.query(
        `DELETE FROM "permissions" WHERE "permission" = $1`,
        [permission],
      );
    }
  }
}
