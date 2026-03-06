import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Update promptCodes for renamed translation prompt files.
 * Old generic names (system, user, text, system_guardrail) → descriptive names.
 */
export class RenameTranslationPromptCodes1772711000000 implements MigrationInterface {
  name = 'RenameTranslationPromptCodes1772711000000';

  private readonly RENAMES: [string, string][] = [
    ['openai_translation_system', 'openai_translation_code_mixed_system'],
    ['openai_translation_user', 'openai_translation_speech_reexpression_user'],
    ['openai_translation_text', 'openai_translation_general_text_translation'],
    [
      'openai_translation_system_guardrail',
      'openai_translation_guardrail_translation',
    ],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove old rows (generic names). New rows from PromptsSyncService have correct codes.
    // If new doesn't exist yet, sync will create from files when app starts.
    for (const [oldCode] of this.RENAMES) {
      await queryRunner.query(
        `DELETE FROM "prompts_versions" WHERE "promptId" IN (SELECT id FROM "prompts" WHERE "promptCode" = $1)`,
        [oldCode],
      );
      await queryRunner.query(`DELETE FROM "prompts" WHERE "promptCode" = $1`, [
        oldCode,
      ]);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- down() required by interface; one-way migration
  public async down(queryRunner: QueryRunner): Promise<void> {
    // Down: would need to recreate old rows; not implemented (one-way migration).
  }
}
