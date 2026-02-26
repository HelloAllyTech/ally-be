import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGlobalSettingsTable1772097903562 implements MigrationInterface {
  name = 'AddGlobalSettingsTable1772097903562';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "global_settings" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "value" jsonb NOT NULL, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, CONSTRAINT "UQ_fd6a23c6683883d3a4e6f11a909" UNIQUE ("name"), CONSTRAINT "PK_fec5e2c0bf238e30b25d4a82976" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "global_settings"`);
  }
}
