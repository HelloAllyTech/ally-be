import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roleplay Studio v2 runtime telemetry (append-only, no soft delete):
 *  - roleplay_director_events — one row per director SQS message
 *    (state transitions, rubric turns, disclosure unlocks, stage directions,
 *    the session summary). `payload` keeps the raw message data verbatim.
 *  - roleplay_rubric_scores   — per-(turn, behavior) flattening of
 *    director_rubric_score messages for cheap aggregation.
 */
export class CreateRoleplayTelemetryTables1814000000000 implements MigrationInterface {
  name = 'CreateRoleplayTelemetryTables1814000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "roleplay_director_events" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" uuid NOT NULL, "roomId" character varying NOT NULL, "eventType" character varying NOT NULL, "turnIndex" integer, "payload" jsonb NOT NULL DEFAULT '{}'::jsonb, "occurredAt" TIMESTAMP, CONSTRAINT "PK_roleplay_director_events_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_director_events_session_id" ON "roleplay_director_events" ("scenarioSessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_director_events_room_id" ON "roleplay_director_events" ("roomId")`,
    );

    await queryRunner.query(
      `CREATE TABLE "roleplay_rubric_scores" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" uuid NOT NULL, "roomId" character varying NOT NULL, "turnIndex" integer NOT NULL, "behaviorId" character varying NOT NULL, "score" double precision NOT NULL, "rationale" text, "occurredAt" TIMESTAMP, CONSTRAINT "PK_roleplay_rubric_scores_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_rubric_scores_session_id" ON "roleplay_rubric_scores" ("scenarioSessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_rubric_scores_room_id" ON "roleplay_rubric_scores" ("roomId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_roleplay_rubric_scores_room_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_roleplay_rubric_scores_session_id"`,
    );
    await queryRunner.query(`DROP TABLE "roleplay_rubric_scores"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_roleplay_director_events_room_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_roleplay_director_events_session_id"`,
    );
    await queryRunner.query(`DROP TABLE "roleplay_director_events"`);
  }
}
