import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminRole1747320048081 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "groups" ("name") 
       SELECT 'ADMIN' 
       WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE "name" = 'ADMIN')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "groups" WHERE "name" = 'ADMIN'`);
  }
}
