import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inline discussions on Track 2.0 course items — see docs/course-discussions.md.
 *
 *  - `track_items.hasDiscussion` — the author's per-item switch. Turning it off
 *    hides the thread; it deletes nothing.
 *  - `course_discussions` — one row per (item, organisation), created lazily on
 *    the first post or lock. Courses are shared across organisations but their
 *    discussions are not.
 *  - `course_discussion_posts` — posts and replies. `parentPostId` threads them,
 *    `rootPostId` names the top-level post a reply belongs to (thread lock and
 *    subtree deletes read it), `depth` is 1–3.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateCourseDiscussions1973100000000 implements MigrationInterface {
  name = 'CreateCourseDiscussions1973100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "track_items" ADD COLUMN IF NOT EXISTS "hasDiscussion" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(`
      CREATE TABLE "course_discussions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "trackId" uuid NOT NULL,
        "trackItemId" uuid NOT NULL,
        "isLocked" boolean NOT NULL DEFAULT false,
        "lockedById" integer,
        "lockedAt" TIMESTAMP,
        "createdById" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_course_discussions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_course_discussions_track_item" FOREIGN KEY ("trackItemId")
          REFERENCES "track_items"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_course_discussions_item_tenant" ON "course_discussions" ("trackItemId", "tenant_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "course_discussion_posts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "discussionId" uuid NOT NULL,
        "trackItemId" uuid NOT NULL,
        "authorId" integer NOT NULL,
        "parentPostId" uuid,
        "rootPostId" uuid,
        "depth" smallint NOT NULL DEFAULT 1,
        "content" text NOT NULL,
        "isEdited" boolean NOT NULL DEFAULT false,
        "editedAt" TIMESTAMP,
        "editedById" integer,
        "isDeletedByAuthor" boolean NOT NULL DEFAULT false,
        "isLocked" boolean NOT NULL DEFAULT false,
        "deletedById" integer,
        "deletedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_course_discussion_posts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_course_discussion_posts_depth" CHECK ("depth" BETWEEN 1 AND 3),
        CONSTRAINT "FK_course_discussion_posts_discussion" FOREIGN KEY ("discussionId")
          REFERENCES "course_discussions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_course_discussion_posts_parent" FOREIGN KEY ("parentPostId")
          REFERENCES "course_discussion_posts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_course_discussion_posts_discussion_created" ON "course_discussion_posts" ("discussionId", "createdAt") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_course_discussion_posts_parent" ON "course_discussion_posts" ("parentPostId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "course_discussion_posts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "course_discussions"`);
    await queryRunner.query(
      `ALTER TABLE "track_items" DROP COLUMN IF EXISTS "hasDiscussion"`,
    );
  }
}
