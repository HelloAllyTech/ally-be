import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repoints language-judge rows written with the bare code `en` at `en-IN`.
 *
 * A session that records no `metadata.languageId` is judged under a fallback
 * language, and that fallback was the literal `'en'` — which has no row in
 * `languages` (the platform's English is `en-IN`, plus `en-GB`/`en-US`). Every
 * consumer of these two tables joins back to `languages`, so those rows were
 * silently invisible: glossary consolidation resolves its worklist through
 * `JOIN languages l ON l.value = a.language`, and 129 annotations across 42
 * sessions — 114 of them in the trailing fortnight, the fastest-growing English
 * pool we had, from two real customer orgs — could never reach it.
 *
 * The fallback itself is fixed in LanguageJudgeRepository
 * (DEFAULT_JUDGE_LANGUAGE); this is the backfill for rows already written.
 *
 * Scoped to exactly `'en'` and left as a no-op for every other value. `en-GB`
 * and `en-US` are real rows chosen deliberately and are NOT touched. The
 * update is a relabel, not a reinterpretation: these sessions were already
 * being judged as English, and the judgments/annotations themselves are
 * unchanged — only the language code they file under.
 *
 * Irreversible by design: `down()` cannot distinguish a row this migration
 * relabelled from one legitimately judged as `en-IN`, and restoring a code with
 * no `languages` row would only re-hide the data. Down is a documented no-op.
 */
export class NormalizeOrphanEnJudgeLanguage1945000000000 implements MigrationInterface {
  name = 'NormalizeOrphanEnJudgeLanguage1945000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE language_error_annotations
          SET "language" = 'en-IN'
        WHERE "language" = 'en'`,
    );
    await queryRunner.query(
      `UPDATE language_judgment_sessions
          SET "language" = 'en-IN'
        WHERE "language" = 'en'`,
    );
  }

  public async down(): Promise<void> {
    // Intentionally empty — see the class comment.
  }
}
