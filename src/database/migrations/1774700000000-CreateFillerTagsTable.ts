import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFillerTagsTable1774700000000 implements MigrationInterface {
  name = 'CreateFillerTagsTable1774700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "filler_tags" (
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "createdBy" integer,
        CONSTRAINT "PK_filler_tags_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_filler_tags_name_lower" ON "filler_tags" (LOWER("name"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_filler_tags_name_lower"`);
    await queryRunner.query(`DROP TABLE "filler_tags"`);
  }
}
