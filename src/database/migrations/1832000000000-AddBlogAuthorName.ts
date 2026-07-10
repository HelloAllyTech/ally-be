import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an optional free-form author display name to blog posts. This is distinct
 * from created_by (the super-admin user id that owns the record) — it is the
 * byline shown publicly, e.g. "By Jane Doe".
 */
export class AddBlogAuthorName1832000000000 implements MigrationInterface {
  name = 'AddBlogAuthorName1832000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blogs" ADD "author_name" character varying(120)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "blogs" DROP COLUMN "author_name"`);
  }
}
