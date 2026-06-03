import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes three orphan prompt rows that referenced "ghost" scenario
 * placeholders (personality, tone, starting_state, emotional_needs,
 * life_history_summary, core_memories, agent_goal,
 * session_behavior_guidelines, response_length).
 *
 * Background
 * ----------
 * Those 9 placeholders were introduced in PR #350 (Oct 2025) alongside a
 * "simulator-creator" UI that authored structured character/behaviour
 * fields. The UI was removed in Jan 2026 ("Remove deprecated simulation
 * step constants"); the backend plumbing (DTO fields, util mapping,
 * translation passthrough, ally-ai-learn consumers) was finally pruned
 * in this cleanup batch.
 *
 * What this migration touches
 * ---------------------------
 * Three rows inserted by `addAILearnPrompts1771309206790`:
 *   - ally_ai_learn_default              (orphan: only referenced in a
 *                                          doc comment, never invoked)
 *   - ally_ai_learn_client_persona_template (orphan: never invoked; the
 *                                          template body explicitly
 *                                          references {personality},
 *                                          {tone}, {starting_state}, etc.
 *                                          which would all substitute
 *                                          empty now)
 *   - ally_ai_learn_prosody_generation   (orphan: superseded by the
 *                                          file-backed
 *                                          app/prompts/prosody/
 *                                          default_generation_prompt.txt
 *                                          in ally-ai-learn)
 *
 * Both the rows and their `prompts_versions` children are dropped.
 *
 * Safety
 * ------
 * - Cross-referenced grep: none of these three promptCodes is read at
 *   runtime anywhere in ally-ai-learn or ally-be (outside the original
 *   migration that inserted them). Removing them changes no observable
 *   behaviour.
 * - The studio's Prompt Management page won't lose anything important:
 *   these rows had no `promptType` set and were never user-editable
 *   targets.
 * - `down()` is a no-op: we don't want a rollback to re-insert orphans
 *   that the next sync would just leave un-rendered.
 */
export class RemoveGhostFieldPrompts1780300000000 implements MigrationInterface {
  name = 'RemoveGhostFieldPrompts1780300000000';

  private readonly orphanPromptCodes = [
    'ally_ai_learn_default',
    'ally_ai_learn_client_persona_template',
    'ally_ai_learn_prosody_generation',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Delete versions first to keep FK consistency (prompts_versions has
    // an FK to prompts.id). Both DELETEs are no-ops if the rows are
    // already absent — safe to re-run.
    await queryRunner.query(
      `DELETE FROM "prompts_versions"
         WHERE "promptId" IN (
           SELECT id FROM "prompts" WHERE "promptCode" = ANY($1::text[])
         )`,
      [this.orphanPromptCodes],
    );
    const result = await queryRunner.query(
      `DELETE FROM "prompts" WHERE "promptCode" = ANY($1::text[])`,
      [this.orphanPromptCodes],
    );

    console.log(
      `[removeGhostFieldPrompts] deleted ${result?.length ?? 0} ` +
        `orphan prompt row(s): ${this.orphanPromptCodes.join(', ')}`,
    );
  }

  public async down(): Promise<void> {
    // Intentional no-op. The deleted rows were orphans; restoring them
    // would re-introduce dead data that referenced ghost placeholders
    // we just cleaned up everywhere else.
  }
}
