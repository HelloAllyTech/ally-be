import { MigrationInterface, QueryRunner } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';

export class AddInitialGroupData1745473668809 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const group of Object.values(UserRole)) {
      await queryRunner.query(`INSERT INTO "groups" ("name") VALUES ($1)`, [
        group,
      ]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const group of Object.values(UserRole)) {
      await queryRunner.query(`DELETE FROM "groups" WHERE "name" = $1`, [
        group,
      ]);
    }
  }
}
