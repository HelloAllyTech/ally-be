import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-learner memory for the AI supervisor's post-roleplay debrief note.
 *
 * Why a new table rather than a column on an existing one
 * ------------------------------------------------------
 * The two memories we already had are both keyed to a *session* and both
 * describe the *client*: `scenario_session_details.sessionMemory` (the live
 * agent's rolling summary) and `summary.feedback.cumulativeMemory` (the case's
 * therapeutic narrative). This one is keyed to a *learner* and describes the
 * practitioner — it has to survive across every case, scenario and track they
 * ever touch, so it cannot hang off a session row.
 *
 * `users.metadata` was the other candidate. Rejected: that jsonb is read on
 * effectively every authenticated request, and an LLM-written blob that grows
 * with each session does not belong on that path.
 *
 * One live row per learner, no history
 * ------------------------------------
 * The unique index is the whole concurrency story — two sessions ending at once
 * for the same learner both upsert onto it, so the later write wins rather than
 * silently forking the learner into two memories. History is deliberately not
 * retained: the supervisor only ever needs what is true now, and an unbounded
 * per-learner log of LLM-written text about someone's professional weaknesses
 * is a retention question nobody has answered yet. The shallow trail the note
 * actually uses lives inside the payload as `recentSessions`.
 *
 * Keyed on ("counselorId", tenant_id), not "counselorId" alone: tenant
 * isolation is not optional in this schema, and a memory leaking across tenants
 * would leak one org's assessment of a person into another's.
 *
 * No backfill, and none possible — a learner's first session after this ships
 * writes their first row, and until then the note simply opens without a
 * continuity callback (ally-ai is given "No previous sessions with this learner
 * yet." and told not to imply it has met them before).
 */
export class CreateLearnerSupervisorMemory1922000000000 implements MigrationInterface {
  name = 'CreateLearnerSupervisorMemory1922000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "learner_supervisor_memory" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying NOT NULL,
        "counselorId" integer NOT NULL,
        "memory" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "lastScenarioSessionId" uuid,
        CONSTRAINT "PK_learner_supervisor_memory" PRIMARY KEY ("id")
      )
    `);

    // The upsert target for every debrief write, and the tenant-isolation
    // guarantee. See the header note.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "learner_supervisor_memory_counselor_tenant_idx"
        ON "learner_supervisor_memory" ("counselorId", "tenant_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "learner_supervisor_memory"`);
  }
}
