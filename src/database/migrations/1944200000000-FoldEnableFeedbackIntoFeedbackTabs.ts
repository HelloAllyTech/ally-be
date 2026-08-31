import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collapses the four post-session feedback switches on a roleplay down to two:
 * Debrief and Transcript. Retires the `enableFeedback` master switch and the
 * `skills` sub-toggle from `scenarios.metadata`.
 *
 * WHY: the authoring form had a master "Post-Session Feedback" toggle plus three
 * sub-toggles under it (Debrief, Skills, Transcript). Skills Demonstrated has
 * been off platform-wide since 2026-08-24, so one of the three never did
 * anything, and the master switch only ever meant "all of them off" — a state
 * the two remaining toggles can express by themselves. Four controls for two
 * outcomes.
 *
 * ## The master switch has to be folded in, not just hidden
 *
 * `resolveFeedbackTabs` used to short-circuit to all-off on
 * `enableFeedback === false`. Dropping that read without touching the data
 * would silently switch both tabs ON for every roleplay an author had
 * deliberately turned feedback off for — 17 of 58 scenarios in the local seed,
 * so this is not a hypothetical cohort. Keeping the read instead would be
 * worse in a quieter way: the form would show both toggles ON while the
 * learner saw nothing, with no control anywhere to explain or fix it.
 *
 * So the flag is translated into the vocabulary that survives: a roleplay with
 * `enableFeedback: false` gets `feedbackTabs: {debrief: false, transcript: false}`.
 * Behaviour is preserved exactly, and — unlike before — the state is now
 * visible and editable in the two toggles that remain.
 *
 * This overwrites any `feedbackTabs` already stored on those rows, which is
 * correct: `enableFeedback: false` overrode whatever it said anyway, so the
 * stored object was already dead data.
 *
 * ## Three statements, narrow WHERE clauses
 *
 * Each `UPDATE` touches only rows that actually carry the key, so a re-run is a
 * no-op rather than a rewrite of every scenario row. Order matters: the fold
 * runs before `enableFeedback` is dropped, since it reads that flag.
 *
 * ## down() is approximate, deliberately
 *
 * Reversing the fold cannot distinguish a roleplay that had
 * `enableFeedback: false` from one that legitimately had both tabs switched off
 * — after this migration they are the same row. down() maps both back to
 * `enableFeedback: false`, which restores the observable behaviour (no
 * post-session feedback) even where it misattributes the reason. `skills` comes
 * back as `false`, matching the platform-wide default it had before removal
 * rather than guessing at a per-roleplay value that is no longer recorded.
 */
export class FoldEnableFeedbackIntoFeedbackTabs1944200000000
  implements MigrationInterface
{
  name = 'FoldEnableFeedbackIntoFeedbackTabs1944200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. A wholesale opt-out becomes both tabs off, in the surviving vocabulary.
    await queryRunner.query(`
      UPDATE "scenarios"
      SET "metadata" = jsonb_set(
        COALESCE("metadata", '{}'::jsonb),
        '{feedbackTabs}',
        '{"debrief": false, "transcript": false}'::jsonb,
        true
      )
      WHERE "metadata" ->> 'enableFeedback' = 'false'
    `);

    // 2. Drop the retired Skills sub-toggle wherever it was persisted.
    await queryRunner.query(`
      UPDATE "scenarios"
      SET "metadata" = jsonb_set(
        "metadata",
        '{feedbackTabs}',
        ("metadata" -> 'feedbackTabs') - 'skills'
      )
      WHERE "metadata" -> 'feedbackTabs' ? 'skills'
    `);

    // 3. The master switch is no longer read anywhere. Leaving it behind would
    //    invite the next reader to treat it as a gate again.
    await queryRunner.query(`
      UPDATE "scenarios"
      SET "metadata" = "metadata" - 'enableFeedback'
      WHERE "metadata" ? 'enableFeedback'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Both-tabs-off is the only trace the master switch left; map it back.
    await queryRunner.query(`
      UPDATE "scenarios"
      SET "metadata" = jsonb_set(
        "metadata",
        '{enableFeedback}',
        'false'::jsonb,
        true
      )
      WHERE "metadata" -> 'feedbackTabs' ->> 'debrief' = 'false'
        AND "metadata" -> 'feedbackTabs' ->> 'transcript' = 'false'
    `);

    // Every other roleplay had the master switch on.
    await queryRunner.query(`
      UPDATE "scenarios"
      SET "metadata" = jsonb_set(
        COALESCE("metadata", '{}'::jsonb),
        '{enableFeedback}',
        'true'::jsonb,
        true
      )
      WHERE NOT ("metadata" ? 'enableFeedback')
    `);

    // Restore Skills at the platform-wide default it carried before removal.
    await queryRunner.query(`
      UPDATE "scenarios"
      SET "metadata" = jsonb_set(
        "metadata",
        '{feedbackTabs,skills}',
        'false'::jsonb,
        true
      )
      WHERE "metadata" ? 'feedbackTabs'
    `);
  }
}
