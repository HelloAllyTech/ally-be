import { MigrationInterface, QueryRunner } from 'typeorm';

export class Dashboard1746006129977 implements MigrationInterface {
  name = 'Dashboard1746006129977';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "dashboard" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "externalId" character varying NOT NULL, "name" character varying NOT NULL, "description" character varying, "order" integer, "groupId" character varying NOT NULL, "organizationId" character varying, "data" jsonb, CONSTRAINT "PK_233ed28fa3a1f9fbe743f571f75" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "dashboard"`);
  }
}
