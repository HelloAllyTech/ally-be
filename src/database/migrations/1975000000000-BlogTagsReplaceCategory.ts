import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires blog categories in favour of tags, and gives each post a chosen
 * cover colour.
 *
 * The public blog now filters by tag ("All" plus every tag in use), so a
 * single category alongside free-form tags was a second, overlapping taxonomy.
 * Before the column goes, each post's category is folded into its tags (unless
 * a tag already spells it, ignoring case) so no post loses the label it was
 * filed under.
 *
 * `cover_color` is the fill shown in place of a header image. It used to be
 * picked by the post's position in the list, so a post changed colour whenever
 * a newer one was published; it is now stored and edited per post.
 *
 * `tags` is guarded with `jsonb_typeof` inside a CASE rather than an AND:
 * Postgres does not short-circuit AND, so a scalar row would still reach
 * `jsonb_array_elements_text` and abort the migration.
 */
export class BlogTagsReplaceCategory1975000000000 implements MigrationInterface {
  name = 'BlogTagsReplaceCategory1975000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "blogs" b
      SET "tags" = (
        CASE WHEN jsonb_typeof(b."tags") = 'array' THEN b."tags" ELSE '[]'::jsonb END
      ) || jsonb_build_array(btrim(b."category"))
      WHERE b."category" IS NOT NULL
        AND btrim(b."category") <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(b."tags") = 'array' THEN b."tags" ELSE '[]'::jsonb END
          ) AS t(tag)
          WHERE lower(btrim(t.tag)) = lower(btrim(b."category"))
        )
    `);
    await queryRunner.query(`ALTER TABLE "blogs" DROP COLUMN "category"`);
    await queryRunner.query(
      `ALTER TABLE "blogs" ADD "cover_color" character varying(7) NOT NULL DEFAULT '#8B9A6D'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "blogs" DROP COLUMN "cover_color"`);
    // The category values were folded into tags and cannot be told apart from
    // them again, so the column comes back empty.
    await queryRunner.query(
      `ALTER TABLE "blogs" ADD "category" character varying(120)`,
    );
  }
}
