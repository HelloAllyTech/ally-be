import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTooltipTranslationsTable1778200000000 implements MigrationInterface {
  name = 'CreateTooltipTranslationsTable1778200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tooltip_translations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tooltipId" character varying NOT NULL, "languageId" integer NOT NULL, "tipText" text NOT NULL, CONSTRAINT "PK_tooltip_translations" PRIMARY KEY ("id"))`,
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
  }
}
