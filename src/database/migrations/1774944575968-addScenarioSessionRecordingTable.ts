import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioSessionRecordingTable1774944575968 implements MigrationInterface {
  name = 'AddScenarioSessionRecordingTable1774944575968';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_session_recordings" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" uuid NOT NULL, "storageKey" character varying(1024) NOT NULL, "egressId" character varying(255) NOT NULL, CONSTRAINT "PK_f30aec4c973f356f4224003ff2d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "scenario_session_recordings_scenario_session_id_uq" ON "scenario_session_recordings" ("scenarioSessionId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."scenario_session_recordings_scenario_session_id_uq"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_session_recordings"`);
  }
}
