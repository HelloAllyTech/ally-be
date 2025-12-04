import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTriggerWarningsTable1764823004361
  implements MigrationInterface
{
  name = 'AddTriggerWarningsTable1764823004361';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "trigger_warnings" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, CONSTRAINT "PK_532211506f835f9c4340806b21c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_trigger_warnings" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioId" integer NOT NULL, "triggerWarningId" uuid NOT NULL, CONSTRAINT "PK_b063681b6dbada4279f6c6cd7f4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_dfebd0c8af592d34a3ac1a75ce" ON "scenario_trigger_warnings" ("scenarioId", "triggerWarningId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfebd0c8af592d34a3ac1a75ce"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_trigger_warnings"`);
    await queryRunner.query(`DROP TABLE "trigger_warnings"`);
  }
}
