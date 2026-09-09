import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Component Library: a global, cross-tenant library of reusable, pre-configured
 * Track/Course item templates (JOURNAL, QUIZ, ARTICLE, VIDEO, ANNOTATED_ARTIFACT
 * only — never ROLEPLAY/CASE/GAME). A course author saves a fully-configured
 * item as a named template here, then inserts it elsewhere as a one-time deep
 * copy of `content`/`completion_criteria` — never a live link.
 *
 * No `tenant_id`: every row is visible to every caller who holds the
 * VIEW_ADMIN_TRACK permission (plus the component_library feature toggle), the
 * same way `track_items` itself carries no tenant scoping. No `deleted_at`:
 * deletes are hard, matching the "inserting copies, it never links back" rule
 * — a template row disappearing must never be observable from content that
 * already copied out of it.
 */
export class CreateTrackComponentTemplates1960000000000 implements MigrationInterface {
  name = 'CreateTrackComponentTemplates1960000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "track_component_templates" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying NOT NULL, "title" character varying NOT NULL, "content" jsonb NOT NULL, "completion_criteria" jsonb, "created_by" integer NOT NULL, "updated_by" integer NOT NULL, CONSTRAINT "PK_track_component_templates_id" PRIMARY KEY ("id"))`,
    );
    // The library's list view is filtered by type (Journal/Quiz/Article/
    // Video/Annotated Artifact tabs), so that lookup gets its own index.
    await queryRunner.query(
      `CREATE INDEX "IDX_track_component_templates_type" ON "track_component_templates" ("type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_track_component_templates_type"`);
    await queryRunner.query(`DROP TABLE "track_component_templates"`);
  }
}
