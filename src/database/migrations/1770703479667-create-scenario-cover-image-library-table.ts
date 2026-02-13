import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScenarioCoverImageLibraryTable1770703479667 implements MigrationInterface {
  name = 'CreateScenarioCoverImageLibraryTable1770703479667';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_cover_image_library" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "image_url" text NOT NULL,
        "created_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scenario_cover_image_library_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_cover_image_library_created_at" ON "scenario_cover_image_library" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_scenario_cover_image_library_created_at"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_cover_image_library"`);
  }
}
