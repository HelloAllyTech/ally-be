import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An admin may rewrite a bug's description before putting Bug Hunter on it.
 *
 * The description is not decoration: `buildFixSessionPrompt` puts it in the
 * fix agent's prompt as the entire statement of what is wrong ("Bug:
 * ${finding.description}"), and `BugHunterRepoClassifierService` reads it to
 * decide which repo the bug even belongs to. So a vague human report or a
 * wordy finder paragraph is not a cosmetic problem — it is the input quality
 * of the whole fix session, and until now the only way to improve it was to
 * reject the bug and file a better one.
 *
 * Three columns, no new status, and the CHECK constraint on
 * `bug_hunt_events.stage` widened by one value — same `bug_findings` /
 * `bug_hunt_events` precedent as every prior Bug Hunter migration; never run
 * `migration:generate` against these tables.
 *
 * 1. `original_description` — the finder's or reporter's own words, captured
 *    on the FIRST edit only and never overwritten afterwards. An edit that
 *    replaced the text outright would destroy the only record of what Bug
 *    Hunter actually found, which is the thing a reviewer needs when a fix
 *    goes wrong: was the agent wrong, or was it told the wrong thing?
 * 2. `description_edited_by` / `description_edited_at` — who last rewrote it
 *    and when, as queryable columns rather than only a buried event payload,
 *    mirroring `released_by`/`released_at` and `cancelled_by`/`cancelled_at`.
 * 3. `bug_hunt_events.stage` gains `'description_edited'`, so the drawer's
 *    per-finding timeline shows the rewrite in sequence with the fix session
 *    it preceded. Fits the existing `character varying(20)` at 18 chars.
 *
 * `dedupe_key` is deliberately NOT recomputed on an edit. It is derived from
 * `file` + `source` + `symbol`, falling back to a fingerprint of the
 * description — of the FINDER's description. Leaving the stored key alone is
 * what lets tonight's sweep re-find this same bug (whose finder-side text is
 * unchanged) and touch this row instead of opening a duplicate.
 */
export class AddBugFindingDescriptionEdit1916000000000 implements MigrationInterface {
  name = 'AddBugFindingDescriptionEdit1916000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_findings"
        ADD COLUMN "original_description" text,
        ADD COLUMN "description_edited_by" integer,
        ADD COLUMN "description_edited_at" TIMESTAMP`,
    );

    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "CHK_bug_hunt_events_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD CONSTRAINT "CHK_bug_hunt_events_stage" CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed',
        'session_dispatched', 'release_dispatched', 'released', 'release_failed',
        'plan_created', 'step_started', 'cancelled', 'description_edited'
      ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" DROP CONSTRAINT "CHK_bug_hunt_events_stage"`,
    );
    // These rows would violate the restored CHECK. Unlike a cancelled finding
    // there is no nearest-equivalent stage to map them onto — an edit is not a
    // pipeline step — so they go, which is also the only lossy part of this
    // rollback: the edited text itself stays in `description`.
    await queryRunner.query(
      `DELETE FROM "bug_hunt_events" WHERE "stage" = 'description_edited'`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events" ADD CONSTRAINT "CHK_bug_hunt_events_stage" CHECK ("stage" IN (
        'skipped_disabled', 'finder_result', 'verify', 'fix_attempt',
        'test_written', 'doc_updated', 'pr_opened', 'merged', 'escalated',
        'error', 'settings_changed',
        'session_dispatched', 'release_dispatched', 'released', 'release_failed',
        'plan_created', 'step_started', 'cancelled'
      ))`,
    );

    await queryRunner.query(
      `ALTER TABLE "bug_findings"
        DROP COLUMN "description_edited_at",
        DROP COLUMN "description_edited_by",
        DROP COLUMN "original_description"`,
    );
  }
}
