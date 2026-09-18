import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `llm_task_configs` — per-AI-task model selection, editable without a
 * deploy.
 *
 * The gap it closes: the AI Tasks screen is derived from a hand-written
 * constant and is read-only, so 43 of its 71 rows are literals copied from
 * another repo by hand and none of them can be changed by an admin. Switching
 * a task's model was a code change in whichever service owned the call, and ten
 * of those services shared one Anthropic-named env var — so when that vendor's
 * credential lapsed, all ten failed together with no lever to move them.
 *
 * No rows are seeded. An absent row means "no per-task selection", which is
 * exactly the behaviour that shipped before this table, so applying this
 * migration changes nothing about what runs. That is deliberate: the switch to
 * OpenAI defaults happens by editing the tier env vars or these rows, one task
 * at a time and reversibly, not by a migration that moves every task at once.
 *
 * Keyed by registry row id rather than `LlmTask` — see the entity for why the
 * usage label cannot identify a call.
 */
export class CreateLlmTaskConfigs1956000000000 implements MigrationInterface {
  name = 'CreateLlmTaskConfigs1956000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "llm_task_configs" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"task_id" character varying(100) NOT NULL, ` +
        `"provider" character varying(50), ` +
        `"model" character varying(100), ` +
        `"temperature" double precision, ` +
        `"fallback_enabled" boolean NOT NULL DEFAULT true, ` +
        `"updated_by" uuid, ` +
        `"note" text, ` +
        `CONSTRAINT "PK_llm_task_configs" PRIMARY KEY ("id")` +
        `)`,
    );

    // Unique rather than a plain index: two rows for one task would make
    // resolution depend on row order, which is the kind of bug that only shows
    // up as "the model I set is not the one running".
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_llm_task_configs_task_id" ` +
        `ON "llm_task_configs" ("task_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_llm_task_configs_task_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "llm_task_configs"`);
  }
}
