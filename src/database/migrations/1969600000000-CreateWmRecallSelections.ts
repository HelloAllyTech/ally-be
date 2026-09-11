import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-turn record of the voice agent's working-memory recall.
 *
 * `recall.select` has always returned every score it considered — its docstring says that is
 * "what makes the coefficients above tunable from production rather than from argument" — and
 * its only call site threw the scores away on every turn since the feature shipped. The
 * weights on cue hits, similarity, encoding strength and decay have therefore never been
 * tunable from anything but argument, and one consequence is already on record: the first v2v
 * run had cue_hits at 0 throughout, so recall was selecting by encoding strength while
 * appearing to answer the conversation.
 *
 * Deliberately NOT folded into the corpus retrieval log. That measures similarity search
 * against a floor; recall is a multi-term ranking under a hard cap, where no threshold admits
 * or rejects anything. Sharing the table would have meant a precision curve describing a
 * mechanism that does not exist.
 *
 * The unique key is the redelivery defence: an at-least-once queue feeds a blind insert, and
 * without it one redelivered message doubles a turn in every aggregate.
 */
export class CreateWmRecallSelections1969600000000 implements MigrationInterface {
  name = 'CreateWmRecallSelections1969600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "wm_recall_selections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid,
        "scenarioSessionId" uuid NOT NULL,
        "turnIndex" integer NOT NULL,
        "stance" character varying,
        "cue_tier" character varying NOT NULL,
        "cue_count" integer NOT NULL DEFAULT 0,
        "pool_size" integer NOT NULL DEFAULT 0,
        "cap" integer NOT NULL DEFAULT 0,
        "selected" jsonb NOT NULL DEFAULT '[]',
        "passed_over" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wm_recall_selections" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "wm_recall_selection_session_turn_uq"
        ON "wm_recall_selections" ("scenarioSessionId", "turnIndex")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "wm_recall_selection_session_idx"
        ON "wm_recall_selections" ("scenarioSessionId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "wm_recall_selection_cue_tier_idx"
        ON "wm_recall_selections" ("cue_tier")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "wm_recall_selections"`);
  }
}
