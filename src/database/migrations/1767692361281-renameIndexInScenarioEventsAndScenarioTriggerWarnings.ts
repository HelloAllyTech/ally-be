import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameIndexInScenarioEventsAndScenarioTriggerWarnings1767692361281 implements MigrationInterface {
  name = 'RenameIndexInScenarioEventsAndScenarioTriggerWarnings1767692361281';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfebd0c8af592d34a3ac1a75ce"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d32326c5e618d77db8938c1707"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_trigger_warnings_scenario_id_trigger_warning_id_idx" ON "scenario_trigger_warnings" ("scenarioId", "triggerWarningId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_events_scenario_id_event_id_auto_termination_status_idx" ON "scenario_events" ("scenarioId", "eventId", "autoTerminationStatus") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_events_scenario_id_event_id_auto_termination_status_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_trigger_warnings_scenario_id_trigger_warning_id_idx"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d32326c5e618d77db8938c1707" ON "scenario_events" ("scenarioId", "eventId", "autoTerminationStatus") WHERE ("deletedAt" IS NULL)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_dfebd0c8af592d34a3ac1a75ce" ON "scenario_trigger_warnings" ("scenarioId", "triggerWarningId") `,
    );
  }
}
