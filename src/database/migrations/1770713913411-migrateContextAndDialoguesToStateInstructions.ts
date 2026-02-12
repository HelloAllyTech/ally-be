import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateContextAndDialoguesToStateInstructions1770713913411 implements MigrationInterface {
  name = 'MigrateContextAndDialoguesToStateInstructions1770713913411';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update all scenarios to add stateInstructions with stateId: 2
    // instruction comes from metadata.context (or empty string if not exists)
    // dialogues comes from metadata.agentDialogues (or empty array if not exists)
    await queryRunner.query(`
      UPDATE "scenarios"
      SET "metadata" = jsonb_set(
        COALESCE("metadata", '{}'::jsonb),
        '{stateInstructions}',
        jsonb_build_array(
          jsonb_build_object(
            'stateId', '2',
            'instruction', COALESCE("metadata"->>'context', ''),
            'dialogues', COALESCE("metadata"->'agentDialogues', '[]'::jsonb)
          )
        )
      )
      WHERE "metadata" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove stateInstructions from metadata
    await queryRunner.query(`
      UPDATE "scenarios"
      SET "metadata" = "metadata" - 'stateInstructions'
      WHERE "metadata" IS NOT NULL
        AND "metadata" ? 'stateInstructions'
    `);
  }
}
