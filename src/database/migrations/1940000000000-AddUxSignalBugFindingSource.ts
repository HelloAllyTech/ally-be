import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets `bug_findings.source` hold 'ux_signal', for findings filed by the UX
 * Signals scan (src/ux-signals) from PostHog telemetry.
 *
 * `source` is `character varying(20)` with a CHECK constraint rather than a
 * Postgres enum, per repo convention — an enum cannot gain a value without a
 * table rewrite. Widening a CHECK means dropping and re-adding it with the full
 * value list, which is why every value has to be restated here rather than
 * appended: there is no ALTER ... ADD VALUE for a CHECK.
 *
 * 'ux_signal' is 9 characters, comfortably inside the column's 20.
 *
 * The `down` narrows the constraint back, so it must first clear the rows that
 * would violate it. Deleting them is correct rather than destructive: a UX
 * finding is a derived artefact — the scan re-detects the same signal on its next
 * run — and there is no other table whose rows depend on one. Findings that have
 * already been acted on (a fix session, a merged PR) are the exception worth
 * knowing about, and the delete is scoped to leave them alone rather than erase
 * the record of work that happened.
 */
export class AddUxSignalBugFindingSource1940000000000 implements MigrationInterface {
  name = 'AddUxSignalBugFindingSource1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only the untouched ones. A ux_signal finding that reached a fix session or
    // a PR is a record of real work, and a schema rollback is not a reason to
    // delete it — it keeps its value and the narrowed CHECK is not re-added.
    await queryRunner.query(
      `DELETE FROM "bug_findings"
       WHERE "source" = 'ux_signal'
         AND "status" IN ('new', 'pending_approval', 'rejected', 'dismissed')`,
    );

    const [{ remaining }] = (await queryRunner.query(
      `SELECT COUNT(*)::int AS remaining FROM "bug_findings" WHERE "source" = 'ux_signal'`,
    )) as Array<{ remaining: number }>;

    if (remaining > 0) {
      // Leaving the widened CHECK in place is the honest outcome: the alternative
      // is either deleting acted-upon findings or failing the rollback outright,
      // and neither serves whoever is running it.
      return;
    }

    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT IF EXISTS "CHK_bug_findings_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD CONSTRAINT "CHK_bug_findings_source" CHECK ("source" IN (
        'test_failure', 'lint_error', 'code_review', 'production_log',
        'reported_bug', 'analytics_suggestion'
      ))`,
    );
  }
}
