import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-time cleanup for a real, reported pattern: before
 * `bug-hunt-sweep-prompt.ts` was told to group same-rule lint findings, the
 * sweep filed one `bug_findings` row PER FILE for `react-hooks/exhaustive-deps`
 * — ten components with a missing/unnecessary hook dependency opened ten
 * near-identical rows instead of one. This merges every such row still at
 * `NEW` (untouched by a reviewer) into the oldest one per repo, rejecting the
 * rest as `duplicate` and pointing back at the survivor.
 *
 * Deliberately scoped to ONE specific, well-known ESLint message shape
 * (`react-hooks/exhaustive-deps`'s "React Hook useX has a missing/unnecessary
 * dependency" text, which is a fixed string this rule always emits verbatim —
 * confirmed against the reported examples) rather than a generic
 * "same-looking lint findings" heuristic: without production data to verify a
 * broader pattern against, a loose match risks silently rejecting a real,
 * distinct bug as a duplicate. Extend the WHERE clause deliberately, case by
 * case, if another repeated-rule pattern turns up — never widen it to "any
 * lint_error" without checking what would actually match first.
 *
 * Only ever touches `NEW` rows: anything already approved, queued, fixing, or
 * further along is a reviewer's or an agent's decision in progress, not raw
 * finder noise, and this migration must never override that.
 */
export class MergeDuplicateExhaustiveDepsLintFindings1971600000000 implements MigrationInterface {
  name = 'MergeDuplicateExhaustiveDepsLintFindings1971600000000';

  private static readonly RULE_PATTERN =
    'react hook use\\w+ has (a missing|an unnecessary) dependency';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{
      id: string;
      repo: string;
      file: string | null;
      title: string;
      createdAt: Date;
    }> = await queryRunner.query(
      `
      SELECT id, repo, file, title, "createdAt"
      FROM bug_findings
      WHERE source = 'lint_error'
        AND status = 'new'
        AND (title ~* $1 OR description ~* $1)
      ORDER BY repo, "createdAt" ASC
      `,
      [MergeDuplicateExhaustiveDepsLintFindings1971600000000.RULE_PATTERN],
    );

    const byRepo = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = byRepo.get(row.repo) ?? [];
      group.push(row);
      byRepo.set(row.repo, group);
    }

    for (const group of byRepo.values()) {
      if (group.length < 2) continue;

      const [canonical, ...duplicates] = group;
      const otherFiles = [
        ...new Set(duplicates.map((d) => d.file).filter(Boolean)),
      ] as string[];

      if (otherFiles.length) {
        await queryRunner.query(
          `UPDATE bug_findings SET description = description || $1 WHERE id = $2`,
          [
            `\n\nThis rule also fires in: ${otherFiles.join(', ')} — merged into this finding rather than filed separately.`,
            canonical.id,
          ],
        );
      }

      for (const dup of duplicates) {
        await queryRunner.query(
          `
          UPDATE bug_findings
          SET status = 'rejected',
              decision_reason = 'duplicate',
              decision_note = $1,
              decided_at = now()
          WHERE id = $2
          `,
          [
            `Merged into finding ${canonical.id} — same react-hooks/exhaustive-deps rule reported across multiple files, consolidated into one finding.`,
            dup.id,
          ],
        );
      }
    }
  }

  public async down(): Promise<void> {
    // Deliberately a no-op: reversing would mean guessing which rejected rows
    // this migration touched vs. ones a human separately declined as
    // duplicate afterward — not distinguishable after the fact, and the
    // decision (real duplicates, correctly consolidated) is not wrong data to
    // roll back.
  }
}
