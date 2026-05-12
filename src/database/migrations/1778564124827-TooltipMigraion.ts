import { MigrationInterface, QueryRunner } from 'typeorm';

export class TooltipMigraion1778564124827 implements MigrationInterface {
  name = 'TooltipMigraion1778564124827';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tooltips" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "location" character varying NOT NULL, "tipText" text NOT NULL, "icon" text, "active" boolean NOT NULL DEFAULT false, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, CONSTRAINT "PK_62b2c578f9c6514659e4eceacbb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tooltips_location_idx" ON "tooltips" ("location") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tooltip_translations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tooltipId" character varying NOT NULL, "languageId" integer NOT NULL, "tipText" text NOT NULL, CONSTRAINT "PK_c901aaa6be2495e43848fec10ac" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_tooltip_translations_tooltip_id_lang_id_idx" ON "tooltip_translations" ("tooltipId", "languageId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_tooltip_translations_tooltip_id_lang_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "tooltip_translations"`);
    await queryRunner.query(`DROP INDEX "public"."uq_tooltips_location_idx"`);
    await queryRunner.query(`DROP TABLE "tooltips"`);
  }
}
