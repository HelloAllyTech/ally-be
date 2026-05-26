import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeScenarioSessionIdToUuid1779721000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. scenario_session_details
    await queryRunner.query(
      `ALTER TABLE "scenario_session_details" ALTER COLUMN "scenarioSessionId" TYPE uuid USING "scenarioSessionId"::uuid`,
    );

    // 2. scenario_session_events
    await queryRunner.query(
      `ALTER TABLE "scenario_session_events" ALTER COLUMN "scenarioSessionId" TYPE uuid USING "scenarioSessionId"::uuid`,
    );

    // 3. scenario_session_messages
    await queryRunner.query(
      `ALTER TABLE "scenario_session_messages" ALTER COLUMN "scenarioSessionId" TYPE uuid USING "scenarioSessionId"::uuid`,
    );

    // 4. scenario_session_feedbacks (from service code discovery)
    await queryRunner.query(
      `ALTER TABLE "scenario_session_feedbacks" ALTER COLUMN "scenarioSessionId" TYPE uuid USING "scenarioSessionId"::uuid`,
    );

    // 5. scenario_session_reflection_prompt_response
    await queryRunner.query(
      `ALTER TABLE "scenario_session_reflection_prompt_response" ALTER COLUMN "scenarioSessionId" TYPE uuid USING "scenarioSessionId"::uuid`,
    );

    // 6. scenario_session_behavior_instructions
    await queryRunner.query(
      `ALTER TABLE "scenario_session_behavior_instructions" ALTER COLUMN "scenarioSessionId" TYPE uuid USING "scenarioSessionId"::uuid`,
    );

    // 7. scenario_session_message_tags
    await queryRunner.query(
      `ALTER TABLE "scenario_session_message_tags" ALTER COLUMN "scenarioSessionId" TYPE uuid USING "scenarioSessionId"::uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables = [
      'scenario_session_details',
      'scenario_session_events',
      'scenario_session_messages',
      'scenario_session_feedbacks',
      'scenario_session_reflection_prompt_response',
      'scenario_session_behavior_instructions',
      'scenario_session_message_tags',
    ];

    for (const table of tables) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "scenarioSessionId" TYPE varchar USING "scenarioSessionId"::varchar`,
      );
    }
  }
}
