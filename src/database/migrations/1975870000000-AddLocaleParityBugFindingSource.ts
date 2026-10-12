import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets `bug_findings.source` hold 'locale_parity' (OPP-0782): findings the
 * sweep workflow files itself, from `scripts/i18n-parity.mjs` comparing every
 * locale file with en.json on ally-web and ally-mobile. A script, not a model,
 * which is why the row is `proven` from the start.
 *
 * Same shape as 1940000000000 (ux_signal): the column is a `character
 * varying(20)` under a CHECK, and a CHECK can only be widened by restating
 * every value. 'locale_parity' is 13 characters.
 *
 * The `down` deletes only rows nobody acted on, for the same reason as the
 * ux_signal migration: the script re-files the same finding on its next run,
 * so an untouched row is derived data; one that reached a fix session or a
 * PR is a record of work and keeps its value, leaving the widened CHECK.
 */
export class AddLocaleParityBugFindingSource1975870000000 implements MigrationInterface {
  name = 'AddLocaleParityBugFindingSource1975870000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT IF EXISTS "CHK_bug_findings_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD CONSTRAINT "CHK_bug_findings_source" CHECK ("source" IN (
        'test_failure', 'lint_error', 'code_review', 'production_log',
        'reported_bug', 'analytics_suggestion', 'ux_signal', 'locale_parity'
      ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "bug_findings"
       WHERE "source" = 'locale_parity'
         AND "status" IN ('new', 'pending_approval', 'rejected', 'dismissed')`,
    );

    const [{ remaining }] = (await queryRunner.query(
      `SELECT COUNT(*)::int AS remaining FROM "bug_findings" WHERE "source" = 'locale_parity'`,
    )) as Array<{ remaining: number }>;
    if (remaining > 0) return;

    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT IF EXISTS "CHK_bug_findings_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD CONSTRAINT "CHK_bug_findings_source" CHECK ("source" IN (
        'test_failure', 'lint_error', 'code_review', 'production_log',
        'reported_bug', 'analytics_suggestion', 'ux_signal'
      ))`,
    );
  }
}
