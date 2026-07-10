import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `blogs` table backing the release-announcement / product-update
 * blog. Posts are platform-global (super-admin authored, publicly readable when
 * published), so there is no tenant column. `status` is DRAFT|PUBLISHED and the
 * slug is unique among non-deleted rows (partial index, soft-delete aware).
 */
export class CreateBlogTable1829000000000 implements MigrationInterface {
  name = 'CreateBlogTable1829000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "blogs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(255) NOT NULL,
        "slug" character varying(280) NOT NULL,
        "tldr" text,
        "body" text,
        "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "category" character varying(120),
        "header_image_url" text,
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "published_at" TIMESTAMP,
        "created_by" integer NOT NULL,
        "updated_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_blogs_id" PRIMARY KEY ("id")
      )`,
    );

    // Unique slug among live (non-deleted) rows.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_blogs_slug_idx" ON "blogs" ("slug") WHERE "deletedAt" IS NULL`,
    );

    // Common access paths: public listing (status + publish date) and admin sort.
    await queryRunner.query(
      `CREATE INDEX "idx_blogs_status_published_at" ON "blogs" ("status", "published_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_blogs_created_at" ON "blogs" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_blogs_created_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_blogs_status_published_at"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_blogs_slug_idx"`);
    await queryRunner.query(`DROP TABLE "blogs"`);
  }
}
