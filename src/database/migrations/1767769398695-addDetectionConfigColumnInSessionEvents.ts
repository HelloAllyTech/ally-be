import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDetectionConfigColumnInSessionEvents1767769398695
  implements MigrationInterface
{
  name = 'AddDetectionConfigColumnInSessionEvents1767769398695';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_events_scenario_id_event_id_auto_termination_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "detectionConfig" jsonb`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_events_scenario_id_event_id_auto_term_status_idx" ON "scenario_events" ("scenarioId", "eventId", "autoTerminationStatus") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_events_scenario_id_event_id_auto_term_status_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "detectionConfig"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_events_scenario_id_event_id_auto_termination_status" ON "scenario_events" ("scenarioId", "eventId", "autoTerminationStatus") WHERE ("deletedAt" IS NULL)`,
    );
  }
}
