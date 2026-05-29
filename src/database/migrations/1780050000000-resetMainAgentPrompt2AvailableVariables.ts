import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-shot data migration: clear `availableVariables` on Main Agent Prompt #2
 * (`ally_ai_learn_system_main_agent_prompt_full`) so the next prompt-sync at
 * boot repopulates it from the meta JSON file.
 *
 * Why this exists
 * ---------------
 * `syncPrompts` deliberately preserves a dashboard-edited row's
 * `availableVariables` list to protect studio-authored trims from being
 * silently overwritten on every container restart:
 *
 *   if (!existing.useDashboardOverride || existingVarsCount === 0) {
 *     updatePayload.availableVariables = item.availableVariables;
 *   }
 *
 * That guard is correct for the steady state, but it traps a one-off
 * migration case: the Main Agent Prompt #2 file body was rewritten to a
 * lean template that no longer references `{behavior_instructions_json}`,
 * yet existing dev/prod rows still carry the old list which DOES include
 * it. The studio's `FormField.hideWhenUnused` reads that list to decide
 * whether to render the Behaviour Instructions editor — so until the list
 * refreshes, the editor stays visible on a prompt that no longer consumes
 * its output.
 *
 * Nulling the column flips `existingVarsCount === 0`, which lets the
 * count-zero branch of the sync guard run and write the meta JSON's
 * full list on the next boot. Body content (`currentContent`) is
 * untouched, so any studio-side body customisation survives.
 *
 * Scope
 * -----
 * Targets exactly one promptCode. Duplicates of this row
 * (`*_copy_<shortId>` codes from "Duplicate as variant") are NOT touched
 * — they live entirely in the DB with no `.meta.json` to repopulate
 * from, so clearing their list would leave them with no advertised
 * variables until an admin re-saves them.
 */
export class ResetMainAgentPrompt2AvailableVariables1780050000000 implements MigrationInterface {
  name = 'ResetMainAgentPrompt2AvailableVariables1780050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts"
         SET "availableVariables" = NULL
       WHERE "promptCode" = 'ally_ai_learn_system_main_agent_prompt_full'`,
    );
  }

  public async down(): Promise<void> {
    // Intentional no-op. The "down" side would need the previous list
    // contents to restore meaningfully, and we don't carry that data.
    // The next prompt-sync after `up()` repopulates from the file, so
    // there's no destructive state to undo from a rollback's perspective.
  }
}
