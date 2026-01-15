import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionEventPrimaryColumnAndIndex1764224409631 implements MigrationInterface {
  name = 'AddSessionEventPrimaryColumnAndIndex1764224409631';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "id" uuid NOT NULL DEFAULT uuid_generate_v4()`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP CONSTRAINT "PK_0ad11b3d9d2757cd37b0af375cd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD CONSTRAINT "PK_c8b07f22d2ed83d6cf12762aae1" PRIMARY KEY ("id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d32326c5e618d77db8938c1707" ON "scenario_events" ("scenarioId", "eventId", "autoTerminationStatus") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d32326c5e618d77db8938c1707"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP CONSTRAINT "PK_c8b07f22d2ed83d6cf12762aae1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD CONSTRAINT "PK_0ad11b3d9d2757cd37b0af375cd" PRIMARY KEY ("scenarioId", "autoTerminationStatus", "eventId")`,
    );
    await queryRunner.query(`ALTER TABLE "scenario_events" DROP COLUMN "id"`);
  }
}
