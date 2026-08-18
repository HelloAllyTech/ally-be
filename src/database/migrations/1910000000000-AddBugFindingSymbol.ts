import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Re-keys `bug_findings` dedup off the finder's prose and onto the code
 * coordinate the bug actually lives at.
 *
 * The old key was `sha256(file::description)`. `description` is LLM-generated,
 * so the same bug worded differently on a later night hashed differently and
 * opened a SECOND row — the sweep manufactured its own duplicates, which is
 * the fastest way to bury the human reviewing this table.
 *
 * `symbol` is the stable half of the new key: the function, class, route,
 * component or endpoint the finding sits on. It is nullable because the
 * existing finders do not emit it yet; BugFindingRepository.dedupeKey falls
 * back to a normalised *fingerprint* of the description in that case, which
 * still collapses rewordings without over-merging two genuinely different
 * bugs in one file.
 *
 * Deliberately NOT adding a `check_class` column: `source` already is that
 * axis (test_failure / lint_error / code_review / production_log / ...), and
 * the new Phase 2 finders extend it naturally (a11y_scan, i18n_scan, ...).
 * Two columns meaning the same thing is the "rule written twice" bug this
 * repo's own fix protocol warns about.
 *
 * One-time effect on existing data: rows still OPEN under an old-format key
 * will not match the new key, so each may get one fresh row the next time it
 * is rediscovered. Self-healing after that round, and preferable to
 * rewriting hashes we cannot recompute (the original description is present,
 * but the old key's semantics are what we are deliberately abandoning).
 */
export class AddBugFindingSymbol1910000000000 implements MigrationInterface {
  name = 'AddBugFindingSymbol1910000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bug_findings"
      ADD COLUMN IF NOT EXISTS "symbol" text
    `);

    // The dedup lookup is always (repo, dedupe_key, status IN open) — see
    // findOpenByDedupeKey. symbol is not itself queried, only hashed, so it
    // needs no index of its own.
    await queryRunner.query(`
      COMMENT ON COLUMN "bug_findings"."symbol" IS
      'Function/class/route/component the finding sits on. Part of the dedupe key; null falls back to a normalised description fingerprint.'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP COLUMN IF EXISTS "symbol"`,
    );
  }
}
