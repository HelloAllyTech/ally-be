import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the prompt-management rows for the deleted generate/regenerate
 * ("auto-generate a scenario field from scratch") feature. These were seeded by
 * addScenarioGeneratableFieldsPrompts (+ later update migrations) under codes
 * `openai_simulation_*` (challenge_description, character_profile_text,
 * opening_dialogues, states, states_instructions, behavior_instructions,
 * linguistic_style_samples[_english], allowed_filler_words[_english],
 * knowledge_sources, role_instruction_default).
 *
 * The feature is superseded by the Agent Builder Copilot (generation) + the
 * per-field Improve/Enhance controls, so these prompt templates + their source
 * .txt files are gone. The Enhance prompts (`enhance_field`, `enhance_state`)
 * and Agent Builder prompts (`agent_builder_*`) are unaffected.
 *
 * Versions are deleted before their parent prompt rows to satisfy the FK.
 * One-way cleanup — `down()` is a no-op (re-run the original seed migrations to
 * restore, though the source templates no longer exist in the repo).
 */
export class DeleteScenarioGeneratableFieldsPrompts1820000000000 implements MigrationInterface {
  name = 'DeleteScenarioGeneratableFieldsPrompts1820000000000';

  private readonly whereClause = `"promptCode" LIKE 'openai_simulation\\_%'`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompts_versions" WHERE "promptId" IN ` +
        `(SELECT "id" FROM "prompts" WHERE ${this.whereClause})`,
    );
    await queryRunner.query(`DELETE FROM "prompts" WHERE ${this.whereClause}`);
  }

  public async down(): Promise<void> {
    // No-op: prompt rows for the removed generate/regenerate feature are
    // intentionally not restored.
  }
}
