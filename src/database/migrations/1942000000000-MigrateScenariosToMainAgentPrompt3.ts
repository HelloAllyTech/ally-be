import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Move every scenario still on Main Agent Prompt #2 to Main Agent Prompt #3.
 *
 *   #2 = ally_ai_learn_system_main_agent_prompt_full
 *   #3 = ally_ai_learn_system_main_agent_prompt_working_memory_split
 *
 * #3 is the client-working-memory variant: it declares one `{working_memory_*}`
 * placeholder per section, which is the entire opt-in for the feature (see
 * `prompt_declares_client_working_memory` in ally-ai-learn). Selecting another
 * prompt is the whole rollback — no redeploy.
 *
 * `jsonb_set` on the single key, deliberately, rather than rewriting `metadata`.
 * The API's updateScenario path REBUILDS metadata from its DTO ("a dropped key
 * would erase..."), so a scripted PUT risks wiping voices, linguistic samples,
 * states and per-language prompt variants. One key is the whole change here.
 *
 * `status` is untouched. Doing this through the Studio autosaves the scenario
 * as DRAFT the moment a field changes, which takes a live scenario offline
 * until it is republished — 7 scenarios were migrated that way by hand first
 * (each flipped, republished and verified), and that hazard is exactly why the
 * remaining 71 come through SQL instead.
 *
 * Scoped by an explicit id list, captured from production on 2026-08-31, AND
 * guarded on the row still being on #2. Belt and braces: the guard means a
 * scenario a curator moved in the meantime is skipped rather than clobbered,
 * and the id list means `down` reverts exactly these rows — not the 11 that
 * were already on #3 before this ran.
 *
 * Not covered, on purpose:
 *   - the Hidden `main_agent_prompt` (#1) and scenarios with no prompt set,
 *     which fall back to it (`fallback_internal_path="system/main_agent_prompt"`)
 *   - `main_agent_prompt_full_copy_*`: curator duplicates of #2 with edited
 *     bodies. Flipping those would discard someone's authoring.
 *   - a scenario moved onto #2 AFTER 2026-08-31; it needs its own pass.
 *
 * Two of these 71 (73, 425-class rows) have no states configured. Under #3 they
 * render the named absence "(this scenario defines no stages)" and get no arc.
 * That is a scenario-authoring gap, not a migration failure, and is left as-is.
 */
const SCENARIO_IDS = [
  73, 186, 187, 218, 222, 224, 279, 284, 285, 336, 341, 344, 346, 357, 358, 359,
  362, 365, 366, 369, 370, 371, 374, 375, 376, 378, 379, 380, 381, 382, 383,
  384, 385, 386, 387, 388, 389, 390, 392, 393, 399, 400, 401, 402, 403, 405,
  406, 409, 410, 411, 412, 413, 414, 418, 419, 427, 428, 429, 430, 433, 435,
  436, 439, 441, 443, 444, 445, 446, 447, 448, 449,
];

/** Rows affected by an `UPDATE ... RETURNING` run through `queryRunner.query`.
 *
 * The driver may hand back the rows directly, or a `[rows, affectedCount]`
 * tuple. Reading `.length` off the tuple silently reports 2 forever, which is
 * how the first draft of this migration claimed to move 2 scenarios during a
 * local run that moved none.
 */
function rowCount(res: unknown): number {
  if (!Array.isArray(res)) return 0;
  if (res.length === 2 && Array.isArray(res[0]) && typeof res[1] === 'number') {
    return res[1];
  }
  return res.length;
}

const PROMPT_2 = 'ally_ai_learn_system_main_agent_prompt_full';
const PROMPT_3 = 'ally_ai_learn_system_main_agent_prompt_working_memory_split';

export class MigrateScenariosToMainAgentPrompt31942000000000 implements MigrationInterface {
  name = 'MigrateScenariosToMainAgentPrompt31942000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const res = await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = jsonb_set("metadata", '{selectedMainPromptCode}', $1::jsonb, true)
        WHERE "id" = ANY($2::int[])
          AND "metadata"->>'selectedMainPromptCode' = $3
        RETURNING "id"`,
      [JSON.stringify(PROMPT_3), SCENARIO_IDS, PROMPT_2],
    );
    // `query()` on an UPDATE ... RETURNING hands back [rows, affectedCount],
    // so `res.length` is the TUPLE length (always 2) rather than the row count.
    // The first version of this logged "moved 2 of 71" against a local run that
    // moved nothing at all; counting the returned rows is what actually works.
    const moved = rowCount(res);
    // Logged rather than asserted equal to 71: a curator moving one of these
    // off #2 between capture and deploy is legitimate, and failing the whole
    // migration for it would be worse than migrating the other 70.
    console.log(
      `[MigrateScenariosToMainAgentPrompt3] moved ${moved} of ${SCENARIO_IDS.length} scenarios #2 -> #3`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const res = await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = jsonb_set("metadata", '{selectedMainPromptCode}', $1::jsonb, true)
        WHERE "id" = ANY($2::int[])
          AND "metadata"->>'selectedMainPromptCode' = $3
        RETURNING "id"`,
      [JSON.stringify(PROMPT_2), SCENARIO_IDS, PROMPT_3],
    );
    console.log(
      `[MigrateScenariosToMainAgentPrompt3] reverted ${rowCount(res)} scenarios #3 -> #2`,
    );
  }
}
