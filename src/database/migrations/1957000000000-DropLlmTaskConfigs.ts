import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `llm_task_configs`, created one commit earlier by `1956000000000`.
 *
 * Why it goes away again: it was a per-task model override editable from the
 * AI Tasks screen. That screen is deliberately read-only — it reports which
 * model serves each call, and nothing more — so no code path ever wrote this
 * table. An unwritten config table is not a lever, it is a second place a
 * model id could be recorded, which is the duplication the AI-task work exists
 * to remove rather than add.
 *
 * What replaced it needs no table. The chain is now
 *
 *   explicit call argument -> prompt row -> platform tier -> compiled-in floor
 *
 * where the prompt row is `prompts.provider/model/temperature` (already
 * admin-editable in System Skills, already loaded on these call paths) and the
 * tier is two env vars. The one thing the table carried that config could not —
 * "never silently substitute another model for this task" — moved onto the AI
 * task registry row as `neverFallback`, which is where it belongs: whether a
 * task's output is stored and trended is a property of the call, not an
 * operator's preference.
 *
 * 1956 is left in place rather than edited. It never ran outside a local
 * database (ally-be deploys are dispatch-only and none was dispatched), so this
 * pair is a no-op on every shared environment — but a developer whose local DB
 * did run it gets the table cleaned up rather than left orphaned.
 */
export class DropLlmTaskConfigs1957000000000 implements MigrationInterface {
  name = 'DropLlmTaskConfigs1957000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_llm_task_configs_task_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "llm_task_configs"`);
  }

  /**
   * Recreates the table so the pair reverts symmetrically. It has no reader,
   * so this exists for migration hygiene rather than because anything would
   * use the result.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_llm_task_configs_task_id" ` +
        `ON "llm_task_configs" ("task_id")`,
    );
  }
}
