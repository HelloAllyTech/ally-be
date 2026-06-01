import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-shot data migration: reconcile `availableVariables` from prompt body
 * text for every prompt row whose list is currently empty/null. This
 * makes the column the single source of truth for body-driven gating in
 * the studio (FormField `hideWhenUnused`, StatesEditor self-hide) and
 * lets us drop the legacy `hasStates` fallback in code.
 *
 * What it does
 * ------------
 * For each row in `prompts` where `availableVariables IS NULL OR
 * jsonb_array_length(...) = 0`:
 *   1. Look up the row's most recent `prompts_versions.prompt` body.
 *   2. Extract every `{placeholder}` reference (same regex used by
 *      `parseVariablesFromPrompt` in src/prompt/util/parse-variables.util.ts).
 *   3. Write the deduped + sorted list as `availableVariables`.
 *
 * Rows whose body has zero placeholders get `[]` (an empty array, not
 * NULL) — the distinction matters: NULL/empty is the trigger for the
 * code-side legacy `hasStates` fallback, and once this migration runs we
 * want NO row to fall through to that branch. After this migration:
 * `availableVariables` is the authoritative answer for "which
 * placeholders does this variant reference?"
 *
 * Mismatch logging
 * ----------------
 * Rows where `hasStates = true` but the body doesn't reference
 * `{state_x_guidelines}` are inconsistent — the flag claims the prompt
 * uses states but the body wouldn't substitute the guidelines. Logged
 * to stdout with their promptCode so an admin can investigate. Once the
 * code-side fallback is dropped, those rows will hide the States UI in
 * edit simulation; the admin must add the placeholder back if they want
 * it to render.
 *
 * Safety
 * ------
 * Untouched rows: those that already have a non-empty
 * `availableVariables` list are left alone — the reconcile-on-save path
 * has been live for a while, so any non-empty list is already trustworthy.
 * Body text is never modified; we only update the metadata column.
 *
 * The `down()` is a no-op: we don't carry the previous (NULL/empty)
 * state, and the next prompt save/sync would re-populate the column
 * anyway, so there's no destructive state to undo.
 */
export class BackfillAvailableVariables1780150000000 implements MigrationInterface {
  name = 'BackfillAvailableVariables1780150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Pull every row that needs backfilling along with its latest body.
    // The LATERAL subselect picks the highest-version row from
    // prompts_versions for each prompt — that's the live version the
    // runtime resolves against, matching `getLatestPromptVersion()` in
    // src/prompt/repository/prompt-version.repository.ts.
    const rows: Array<{
      id: string;
      promptCode: string;
      hasStates: boolean | null;
      body: string | null;
    }> = await queryRunner.query(`
      SELECT
        p.id,
        p."promptCode",
        p."hasStates",
        (
          SELECT pv.prompt
          FROM "prompts_versions" pv
          WHERE pv."promptId" = p.id
          ORDER BY pv.version DESC
          LIMIT 1
        ) AS body
      FROM "prompts" p
      WHERE p."availableVariables" IS NULL
         OR jsonb_array_length(p."availableVariables") = 0
    `);

    let backfilled = 0;
    let mismatches = 0;
    const placeholderRegex = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

    for (const row of rows) {
      const body = row.body ?? '';
      const names = Array.from(
        new Set(Array.from(body.matchAll(placeholderRegex), (m) => m[1])),
      ).sort();

      const referencesStates = names.includes('state_x_guidelines');
      if (row.hasStates && !referencesStates) {
        mismatches++;

        console.warn(
          `[backfillAvailableVariables] promptCode=${row.promptCode}: ` +
            'hasStates=true but body lacks {state_x_guidelines}. After the ' +
            'code-side hasStates fallback is removed, this row will hide its ' +
            'States editor in edit simulation. Re-add the placeholder to the ' +
            'prompt body if the row should still render States.',
        );
      }

      await queryRunner.query(
        `UPDATE "prompts" SET "availableVariables" = $1::jsonb WHERE id = $2`,
        [JSON.stringify(names), row.id],
      );
      backfilled++;
    }

    console.log(
      `[backfillAvailableVariables] backfilled=${backfilled}, ` +
        `mismatches=${mismatches}`,
    );
  }

  public async down(): Promise<void> {
    // Intentional no-op — the previous (NULL/empty) state isn't worth
    // restoring, and the next sync/save will repopulate availableVariables
    // anyway. A rollback wouldn't change runtime behavior.
  }
}
