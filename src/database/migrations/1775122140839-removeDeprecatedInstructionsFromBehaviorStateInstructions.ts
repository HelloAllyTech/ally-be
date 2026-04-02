import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveDeprecatedInstructionsFromBehaviorStateInstructions1775122140839 implements MigrationInterface {
  name =
    'RemoveDeprecatedInstructionsFromBehaviorStateInstructions1775122140839';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_behavior_instructions" DROP COLUMN "instructions"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_behavior_instructions" ADD "instructions" text array NOT NULL`,
    );
  }
}
