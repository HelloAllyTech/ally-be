import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the prompt-management rows for the deleted voice-expression features:
 *  - Speech prosody generation prompts (seeded by addAILearnPrompts, codes
 *    `ally_ai_learn_prosody_*`) — the prosody engine has been removed from
 *    ally-ai-learn entirely.
 *  - Performative Speech / Break Tags guidance prompts
 *    (`ally_ai_learn_system_text_expressivity_guidance`,
 *    `ally_ai_learn_system_break_tag_guidance`, seeded by
 *    AddExpressivityGuidancePrompts) — both features have been removed.
 *
 * KEEPS `ally_ai_learn_system_audio_tag_guidance` (AddAudioTagGuidancePrompt):
 * ElevenLabs v3 inline audio tags are still the active expressivity mechanism.
 *
 * Versions are deleted before their parent prompt rows to satisfy the FK.
 * This is a one-way cleanup — `down()` is a no-op. To restore the rows, re-run
 * the original seed migrations (addAILearnPrompts / AddExpressivityGuidancePrompts).
 */
export class DeleteProsodyAndExpressivityPrompts1799000000000 implements MigrationInterface {
  name = 'DeleteProsodyAndExpressivityPrompts1799000000000';

  private readonly whereClause =
    `("promptCode" LIKE 'ally_ai_learn_prosody%' ` +
    `OR "promptCode" IN ('ally_ai_learn_system_text_expressivity_guidance', ` +
    `'ally_ai_learn_system_break_tag_guidance'))`;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "prompts_versions" WHERE "promptId" IN ` +
        `(SELECT "id" FROM "prompts" WHERE ${this.whereClause})`,
    );
    await queryRunner.query(`DELETE FROM "prompts" WHERE ${this.whereClause}`);
  }

  public async down(): Promise<void> {
    // No-op: prompt rows for removed features are intentionally not restored.
  }
}
