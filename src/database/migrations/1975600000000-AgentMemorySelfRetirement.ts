import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Let Bug Hunter retire its own notebook entries, and say why (OPP-0752).
 *
 * The notebook is capped at 80 active entries and nothing left it on its own:
 * the hourly curator removes an entry only when a new candidate contradicts
 * or subsumes it, so a stale lesson stayed in the twelve the prompt reads
 * every night until an admin noticed. A nightly pass now retires by evidence
 * (`AgentMemoryRetirementService`), and these three columns record who
 * retired an entry and why — null `retired_by` with a reason means the agent
 * did — so the Notebook tab can show "retired by me because…" and an admin
 * can undo it. Nullable, no backfill: rows retired before this have no
 * provenance to recover.
 */
export class AgentMemorySelfRetirement1975600000000 implements MigrationInterface {
  name = 'AgentMemorySelfRetirement1975600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_memories" ADD COLUMN IF NOT EXISTS "retired_at" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_memories" ADD COLUMN IF NOT EXISTS "retired_by" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_memories" ADD COLUMN IF NOT EXISTS "retired_reason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_memories" DROP COLUMN IF EXISTS "retired_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_memories" DROP COLUMN IF EXISTS "retired_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_memories" DROP COLUMN IF EXISTS "retired_at"`,
    );
  }
}
