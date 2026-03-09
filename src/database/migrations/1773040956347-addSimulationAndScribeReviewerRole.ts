import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSimulationAndScribeReviewerRole1773040956347 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "groups" SET "name" = 'SIMULATION_REVIEWER' WHERE "name" = 'REVIEWER'`,
    );

    await queryRunner.query(
      `INSERT INTO "groups" ("name") VALUES ('SCRIBE_REVIEWER')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "groups" WHERE "name" = 'SCRIBE_REVIEWER'`,
    );

    await queryRunner.query(
      `UPDATE "groups" SET "name" = 'REVIEWER' WHERE "name" = 'SIMULATION_REVIEWER'`,
    );
  }
}
