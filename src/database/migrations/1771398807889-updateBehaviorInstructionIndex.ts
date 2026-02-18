import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateBehaviorInstructionIndex1771398807889 implements MigrationInterface {
  name = 'UpdateBehaviorInstructionIndex1771398807889';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_behavior_instruction_behaviors_instruction_id_behav"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_sbi_behaviors_instruction_behavior_idx" ON "scenario_behavior_instruction_behaviors" ("scenarioBehaviorInstructionId", "behaviorId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_sbi_behaviors_instruction_behavior_idx"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_behavior_instruction_behaviors_instruction_id_behav" ON "scenario_behavior_instruction_behaviors" ("scenarioBehaviorInstructionId", "behaviorId") `,
    );
  }
}
