import { MigrationInterface, QueryRunner } from 'typeorm';

import { truncateTitle } from '../../bug-hunter/util/truncate-title.util';

/**
 * Every row `bug_finding.service.ts` wrote before this migration used a raw
 * `.slice(0, 200)` for `title` — a mid-word cut ("...which can result in a
 * degraded u") whenever the source description ran past 200 characters
 * before its first sentence or word break. `truncateTitle` (added alongside
 * this migration) fixes new rows; this backfills existing ones from their own
 * `description`, which was never truncated and still holds the full text.
 *
 * Scoped to rows a hard 200-char slice could actually have produced — title
 * length >= 200 — so a normal, already-short title is never touched.
 */
export class BackfillTruncatedBugFindingTitles1971500000000 implements MigrationInterface {
  name = 'BackfillTruncatedBugFindingTitles1971500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; description: string }> =
      await queryRunner.query(
        `SELECT id, description FROM bug_findings WHERE length(title) >= 200`,
      );

    for (const row of rows) {
      const title = truncateTitle(row.description);
      await queryRunner.query(
        `UPDATE bug_findings SET title = $1 WHERE id = $2`,
        [title, row.id],
      );
    }
  }

  public async down(): Promise<void> {
    // Deliberately a no-op: the previous titles were a display bug (a raw
    // mid-word character cut), not data worth restoring.
  }
}
