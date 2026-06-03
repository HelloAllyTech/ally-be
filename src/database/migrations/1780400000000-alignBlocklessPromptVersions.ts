import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Align `prompts_versions.prompt` (current version) with the updated
 * `prompts.defaultPrompt` for the two ally-ai-learn prompts whose
 * templates were rewritten in the "remove blocks" pass:
 *
 *   - ally_ai_learn_system_main_agent_prompt
 *   - ally_ai_learn_system_branching_agent_prompt
 *
 * Background
 * ----------
 * The ally-ai-learn deploy runs `scripts/sync_prompts.py` on startup,
 * which POSTs to /api/v1/prompts/sync. That endpoint refreshes
 * `prompts.defaultPrompt` (the file body, used as the "Revert to default"
 * target) but DELIBERATELY leaves `prompts_versions.prompt` alone — that
 * column is the studio-editable text and overwriting it would clobber
 * admin edits on every container restart.
 *
 * For these two rows the studio has not been used to edit them
 * (`useDashboardOverride = false` AND `defaultPrompt == prompts_versions.prompt`
 * before the cleanup), so it's safe to refresh the version text to match
 * the new defaultPrompt. Without this migration:
 *   - the runtime would still pick the local `.txt` body (correct),
 *   - BUT the Prompt Management studio page would show the OLD pre-cleanup
 *     body referencing `{profession_block}` / `{previous_memory_block}` /
 *     `{multilingual_instructions_block}` — placeholders that no longer
 *     resolve anywhere. If an admin then toggled `useDashboardOverride=true`
 *     without clicking "Revert to default", the prompt would silently
 *     revert to the stale text and the cleanup would be undone.
 *
 * Safety
 * ------
 * - Only updates the row at `currentVersion` — older versions stay
 *   archived as they were.
 * - Guarded on `useDashboardOverride = false` so any tenant that already
 *   customized the prompt via the studio is left untouched.
 * - No-op if the row is missing (idempotent).
 *
 * Down
 * ----
 * Intentionally a no-op. Restoring the pre-cleanup body would re-introduce
 * block placeholders that no longer have a resolver — broken state.
 */
export class AlignBlocklessPromptVersions1780400000000 implements MigrationInterface {
  name = 'AlignBlocklessPromptVersions1780400000000';

  private readonly targets = [
    'ally_ai_learn_system_main_agent_prompt',
    'ally_ai_learn_system_branching_agent_prompt',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const result = await queryRunner.query(
      `UPDATE "prompts_versions" pv
         SET "prompt" = p."defaultPrompt",
             "updatedAt" = NOW()
        FROM "prompts" p
        WHERE pv."promptId" = p.id
          AND pv."version" = p."currentVersion"
          AND p."useDashboardOverride" = false
          AND p."promptCode" = ANY($1::text[])`,
      [this.targets],
    );

    console.log(
      `[alignBlocklessPromptVersions] aligned ${result?.length ?? 0} ` +
        `prompt version row(s) to current defaultPrompt`,
    );
  }

  public async down(): Promise<void> {
    // No-op. See class docstring.
  }
}
