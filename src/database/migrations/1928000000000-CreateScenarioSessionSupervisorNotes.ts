import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Live supervisor notes — the coaching hints the AI supervisor streams into the
 * learner's sidebar DURING a roleplay session (opt-in per scenario via
 * `metadata.supervisorNotesEnabled`, default off).
 *
 * Why a new table
 * ---------------
 * The notes are an insert-only ordered log of small rows produced mid-session,
 * which is the `scenario_session_messages` shape, not a blob. The two
 * alternatives were both worse: `scenario_session_details` may not have a row
 * yet when the first note lands and already carries three upsert writers, so
 * concurrent jsonb appends there would lose notes; `scenario_sessions.metadata`
 * would bury an append-only log inside a mutable blob that other writers own.
 *
 * The unique (scenarioSessionId, seq) index is the idempotency story: `seq` is
 * assigned by the agent per session, so an SQS redelivery collides instead of
 * duplicating a note the learner already read. It doubles as the read order for
 * the post-session debrief, which is given these notes as context.
 *
 * No backfill and none possible — notes only exist for sessions run after this
 * ships with the scenario toggle on.
 */
export class CreateScenarioSessionSupervisorNotes1928000000000 implements MigrationInterface {
  name = 'CreateScenarioSessionSupervisorNotes1928000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "scenario_session_supervisor_notes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying NOT NULL,
        "scenarioSessionId" uuid NOT NULL,
        "seq" integer NOT NULL,
        "note" text NOT NULL,
        "turnIndex" integer,
        "language" character varying,
        "env" character varying,
        CONSTRAINT "PK_scenario_session_supervisor_notes" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "scenario_session_supervisor_notes_session_id_idx"
        ON "scenario_session_supervisor_notes" ("scenarioSessionId")
    `);

    // Idempotent SQS redelivery + the debrief's read order. See the header note.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "scenario_session_supervisor_notes_session_seq_idx"
        ON "scenario_session_supervisor_notes" ("scenarioSessionId", "seq")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "scenario_session_supervisor_notes"`,
    );
  }
}
