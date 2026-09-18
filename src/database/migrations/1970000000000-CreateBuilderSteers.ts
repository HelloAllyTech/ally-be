import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `builder_steers` — corrections sent to a build already in flight.
 *
 * The inverse of `builder_questions`: that table is the agent asking a person
 * and stopping until it is answered, this one is a person telling the agent
 * something it did not ask for and did not stop for. Until now the only lever
 * over a running build was Cancel, which discards the whole working tree —
 * nothing a run writes is pushed anywhere before FINALISE — along with every
 * dollar that produced it. "It is going the wrong way" and "stop everything"
 * had one button between them.
 *
 * A queue rather than a column on the session, because steers accumulate: an
 * admin watching a build sends three in a minute about three different things,
 * and a single "current instruction" field would silently drop two. They are
 * also a record of what someone said and when, which a field cannot answer
 * afterwards.
 *
 * `deliveredToRunId` is separate from `runId`. The first is the run that
 * actually read the note, the second the run in flight when it was written —
 * a retry is a new run, and the difference between "it was told and ignored
 * it" and "it never heard" is exactly what an incident review needs.
 *
 * ON DELETE CASCADE on the session and SET NULL on the runs: a purged session
 * takes its steers with it, but a deleted run must not delete the record that
 * a person sent a correction.
 */
export class CreateBuilderSteers1970000000000 implements MigrationInterface {
  name = 'CreateBuilderSteers1970000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_steers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "runId" uuid,
        "note" text NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'pending',
        "deliveredAt" TIMESTAMP,
        "deliveredToRunId" uuid,
        "deliveredAtPhase" character varying(32),
        "createdByUserId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_steers_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_steers_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_builder_steers_run" FOREIGN KEY ("runId")
          REFERENCES "builder_build_runs"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_builder_steers_delivered_run" FOREIGN KEY ("deliveredToRunId")
          REFERENCES "builder_build_runs"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_builder_steers_status" CHECK ("status" IN (
          'pending', 'delivered', 'superseded'
        ))
      )`,
    );
    // The pipeline polls this at every phase boundary of every live run, and
    // asks exactly one question: what is still pending for this session.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_steers_session"
         ON "builder_steers" ("sessionId", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_builder_steers_session"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_steers"`);
  }
}
