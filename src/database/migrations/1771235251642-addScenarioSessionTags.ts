import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioSessionTags1771235251642 implements MigrationInterface {
  name = 'AddScenarioSessionTags1771235251642';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_session_tags" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "label" character varying NOT NULL, CONSTRAINT "PK_f778e8ffd7edbb127a2952501e5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_session_tags_label" ON "scenario_session_tags" ("label") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_session_message_tags" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" character varying NOT NULL, "messageId" integer NOT NULL, "tagId" uuid NOT NULL, "category" character varying NOT NULL, CONSTRAINT "PK_0c7a9b136c85f35a9444e2595a7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_session_message_tags_session_message_tag" ON "scenario_session_message_tags" ("scenarioSessionId", "messageId", "tagId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_session_message_tags_session_message_tag"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_session_message_tags"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_session_tags_label"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_session_tags"`);
  }
}
