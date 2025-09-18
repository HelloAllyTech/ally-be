import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAndSeedLearnEntities1757484561931
  implements MigrationInterface
{
  name = 'CreateAndSeedLearnEntities1757484561931';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "session_events" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "name" character varying NOT NULL, "description" character varying NOT NULL, "score" integer NOT NULL, "emoji" character varying NOT NULL, "message" character varying NOT NULL, "branchInstruction" character varying, CONSTRAINT "PK_aeae988940cef0a489a14200af3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scenarios" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" SERIAL NOT NULL, "title" character varying NOT NULL, "scenario" character varying NOT NULL, "description" character varying NOT NULL, "coverImageUrl" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'DRAFT', "prompt" character varying, "metadata" jsonb, CONSTRAINT "PK_a2af4912aab626639cca306b987" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_sessions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "roomId" character varying NOT NULL, "scenarioId" integer NOT NULL, "counselorId" integer NOT NULL, "status" character varying NOT NULL DEFAULT 'ACTIVE', "startedAt" TIMESTAMP, "endedAt" TIMESTAMP, "score" double precision, "metadata" jsonb, CONSTRAINT "PK_2f765e6adcfea2857ac2817bb47" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_sessions_counselor_id_idx" ON "scenario_sessions" ("counselorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_session_messages" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" SERIAL NOT NULL, "scenarioSessionId" character varying NOT NULL, "senderId" integer NOT NULL, "messageType" character varying NOT NULL, "content" character varying NOT NULL, "metadata" jsonb, CONSTRAINT "PK_413db2ef6565d2542af35f0c750" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_messages_scenario_session_id_idx" ON "scenario_session_messages" ("scenarioSessionId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_session_feedbacks" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" character varying NOT NULL, "rating" integer NOT NULL, "feedback" character varying, CONSTRAINT "PK_0af71d1e245817ef97435148a0c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_session_events" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" character varying NOT NULL, "eventId" character varying NOT NULL, "occurredAt" TIMESTAMP NOT NULL, "metadata" jsonb, CONSTRAINT "PK_7df40935fb1e14c2d3a7797af4c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_events_scenario_session_id_idx" ON "scenario_session_events" ("scenarioSessionId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_session_details" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" character varying NOT NULL, "callDuration" integer, "summary" jsonb, CONSTRAINT "PK_82d956c060bd5ff015f6f0343ca" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "scenario_session_details_scenario_session_id_idx" ON "scenario_session_details" ("scenarioSessionId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_events" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "scenarioId" integer NOT NULL, "eventId" character varying NOT NULL, CONSTRAINT "PK_451d8fbb4b158b0fbdb67b4bb42" PRIMARY KEY ("scenarioId", "eventId"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "scenario_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_details_scenario_session_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_session_details"`);
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_events_scenario_session_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_session_events"`);
    await queryRunner.query(`DROP TABLE "scenario_session_feedbacks"`);
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_messages_scenario_session_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_session_messages"`);
    await queryRunner.query(
      `DROP INDEX "public"."scenario_sessions_counselor_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_sessions"`);
    await queryRunner.query(`DROP TABLE "scenarios"`);
    await queryRunner.query(`DROP TABLE "session_events"`);
  }
}
