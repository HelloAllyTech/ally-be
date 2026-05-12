import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTooltipsTable1778176883526 implements MigrationInterface {
  name = 'CreateTooltipsTable1778176883526';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tooltips" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "location" character varying NOT NULL, "tipText" text NOT NULL, "icon" text, "active" boolean NOT NULL DEFAULT false, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, CONSTRAINT "PK_62b2c578f9c6514659e4eceacbb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tooltips_location_idx" ON "tooltips" ("location") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_tooltips_location_idx"`);
    await queryRunner.query(`DROP TABLE "tooltips"`);
  }
}
