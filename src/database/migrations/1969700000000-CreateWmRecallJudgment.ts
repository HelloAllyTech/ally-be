import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Verdicts on the voice agent's recall: was the fact the turn called for among the five?
 *
 * `wm_recall_selections` records the decision and every score behind it. What a score cannot
 * say is whether the choice was right, and the weights that produced it have never been tuned
 * from anything but argument.
 *
 * Four verdicts, and the distinctions between them are the point. `no_demand` is what makes
 * the others readable — most turns of a conversation call for no particular backstory, and
 * without somewhere to put those the rate would be dominated by turns where nothing was
 * needed. `missed_better` and `nothing_apt` separate a RANKING problem (the material was there
 * and the scoring buried it) from a CORPUS one (the character profile lacks it), which have
 * different fixes.
 *
 * Slice columns are denormalised (stance, cue_tier, pool_size) for the same reason as every
 * other judgment table here: the reading is segmented, and a rate that mixes a guarded client
 * with an open one, or scenario-cued turns with conversation-cued ones, is not a rate.
 *
 * The unique key lets a re-judge under a new rubric coexist with the old verdict and makes an
 * interrupted run resumable.
 */
export class CreateWmRecallJudgment1969700000000 implements MigrationInterface {
  name = 'CreateWmRecallJudgment1969700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wm_recall_judgments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid,
        "recall_selection_id" uuid NOT NULL,
        "scenarioSessionId" uuid NOT NULL,
        "turnIndex" integer NOT NULL,
        "verdict" character varying(32) NOT NULL,
        "better_fact" text,
        "unused_selected_count" integer NOT NULL DEFAULT 0,
        "reasoning" text,
        "stance" character varying,
        "cue_tier" character varying,
        "pool_size" integer NOT NULL DEFAULT 0,
        "occurred_at" TIMESTAMP NOT NULL,
        "judge_model" character varying(64) NOT NULL,
        "judge_prompt_version" character varying(16) NOT NULL DEFAULT 'v1',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wm_recall_judgments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_wm_recall_judgments_selection" FOREIGN KEY ("recall_selection_id")
          REFERENCES "wm_recall_selections"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "wm_recall_judgment_judge_uq"
        ON "wm_recall_judgments" (
          "recall_selection_id", "judge_model", "judge_prompt_version")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "wm_recall_judgment_verdict_idx"
        ON "wm_recall_judgments" ("verdict")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "wm_recall_judgment_session_idx"
        ON "wm_recall_judgments" ("scenarioSessionId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "wm_recall_judgment_occurred_at_idx"
        ON "wm_recall_judgments" ("occurred_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "wm_recall_judgment_cue_tier_idx"
        ON "wm_recall_judgments" ("cue_tier")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "wm_recall_judgments"`);
  }
}
