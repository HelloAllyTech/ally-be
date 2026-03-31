import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repair local DBs that ran an earlier CreateFillerTagsTable revision that only
 * created IDX_filler_tags_name_ilike. New installs get UQ from 1774700000000;
 * this migration is idempotent for them (DROP IF EXISTS + CREATE IF NOT EXISTS).
 *
 * If CREATE UNIQUE INDEX fails, dedupe filler_tags where LOWER(name) collides first.
 */
export class FillerTagsUniqueIndexOnLowerName1774800000000 implements MigrationInterface {
  name = 'FillerTagsUniqueIndexOnLowerName1774800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_filler_tags_name_ilike"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_filler_tags_name_lower" ON "filler_tags" (LOWER("name"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_filler_tags_name_lower"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_filler_tags_name_ilike" ON "filler_tags" ("name")`,
    );
  }
}
