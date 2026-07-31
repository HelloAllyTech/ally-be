import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Analytics Suggestions: LLM-drafted product suggestions derived from a chosen
 * analytics window, reviewed by a super-duper-admin and either filed onto the
 * product roadmap or rejected.
 *
 * Why a table rather than a stateless endpoint: the suggestions are a REVIEW
 * QUEUE, and every column here exists to serve one of the three questions a
 * reviewer asks of a proposal they did not write.
 *
 *  - "Where did this come from?" — batch_id groups one Generate run, and the
 *    window_* / model columns pin the provenance of the claim. A suggestion
 *    read a month later without the window it was derived from is unfalsifiable,
 *    so the provenance is stored per row rather than recomputed from a run
 *    header: batches are never edited, and a denormalised copy keeps a row
 *    self-describing even if the surface that grouped it changes.
 *  - "Has this already been decided?" — status plus rejected_reason. Rejections
 *    are fed back into the next generation's prompt, which is the whole reason
 *    the reason is a column and not a UI-only confirmation: an unrecorded "no"
 *    gets re-proposed every run.
 *  - "What became of it?" — opportunity_id, set when a suggestion is accepted
 *    and filed. ON DELETE SET NULL because deleting a roadmap opportunity must
 *    not erase the record that it was proposed and accepted; the suggestion then
 *    reads as accepted with a dangling link, which is the truth.
 *
 * suggested_goal is NULLABLE ON PURPOSE. The model is asked to classify each
 * suggestion into a live roadmap product goal, and an answer that is not a live
 * goal is discarded to NULL rather than stored — the same guard as
 * RoadmapAiService.classifyGoal, and for the same reason: unvalidated model
 * taxonomy once polluted ~54% of the roadmap's goal data. There is deliberately
 * no FK to roadmap_product_goals(name) either, because a suggestion is a draft
 * that must survive a goal being renamed or retired before anyone reviews it;
 * the goal is re-validated at accept time, where a dead goal is a 422 the
 * reviewer can fix in the form.
 */
export class CreateAnalyticsSuggestions1874000000000 implements MigrationInterface {
  name = 'CreateAnalyticsSuggestions1874000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "analytics_suggestions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "batch_id" uuid NOT NULL,
        "title" text NOT NULL,
        "body" text NOT NULL,
        "rationale" text NOT NULL DEFAULT '',
        "evidence" jsonb NOT NULL DEFAULT '[]',
        "suggested_goal" text,
        "suggested_type" character varying(10) NOT NULL DEFAULT 'idea',
        "status" character varying(10) NOT NULL DEFAULT 'pending',
        "rejected_reason" text,
        "opportunity_id" uuid,
        "window_range" character varying(10),
        "window_from" date NOT NULL,
        "window_to" date NOT NULL,
        "window_label" text NOT NULL,
        "model" text NOT NULL,
        "created_by" integer NOT NULL,
        "updated_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analytics_suggestions_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_analytics_suggestions_status"
          CHECK ("status" IN ('pending', 'accepted', 'rejected')),
        CONSTRAINT "CHK_analytics_suggestions_type"
          CHECK ("suggested_type" IN ('idea', 'bug')),
        CONSTRAINT "CHK_analytics_suggestions_title"
          CHECK (length(btrim("title")) > 0),
        CONSTRAINT "CHK_analytics_suggestions_body"
          CHECK (length(btrim("body")) > 0),
        CONSTRAINT "FK_analytics_suggestions_opportunity_id"
          FOREIGN KEY ("opportunity_id") REFERENCES "roadmap_opportunities" ("id")
          ON DELETE SET NULL
      )`,
    );

    // The queue is read by status (pending is the default view) and rendered
    // grouped by batch, newest first.
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_suggestions_status" ON "analytics_suggestions" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_suggestions_batch_id" ON "analytics_suggestions" ("batch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_suggestions_created_at" ON "analytics_suggestions" ("createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_suggestions_opportunity_id" ON "analytics_suggestions" ("opportunity_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_analytics_suggestions_opportunity_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_analytics_suggestions_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_analytics_suggestions_batch_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_analytics_suggestions_status"`,
    );
    await queryRunner.query(`DROP TABLE "analytics_suggestions"`);
  }
}
