import { MigrationInterface, QueryRunner } from 'typeorm';
import { GROUPS } from '../../common/constants/auth.constants';

export class AddInitialGroupData1745473668809 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const group of GROUPS) {
      await queryRunner.query(`INSERT INTO "groups" ("group") VALUES ($1)`, [
        group,
      ]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const group of GROUPS) {
      await queryRunner.query(`DELETE FROM "groups" WHERE "group" = $1`, [
        group,
      ]);
    }
  }
}
