import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Re-queue mined word pairs that are stuck behind the Tier 0 cap.
 *
 * The first write-mode lexeme-mining run (2026-09-25) queued its pairs into
 * each language's `core_style`, an always-on section. Tamil's always-on block
 * was already at 2320 of 2000 tokens, so the adjudicator deferred every one of
 * them ("cap blocked core_style") and would keep deferring them forever. The
 * job now queues into an on-demand section instead
 * (GlossaryLexemeMiningService.pickTargetSection); this moves the pairs it had
 * already queued to where it would queue them now.
 *
 * Only still-PROPOSED `lexeme_mining` entries in always-on global sections
 * move; accepted and rejected ones stay put. Target, per language: an
 * on-demand published `general_vocabulary`, else `everyday_words`, else a new
 * `everyday_words` (published, on-demand, pinned). Moved entries lose their
 * adjudication deferral state so the next pass decides them promptly, and
 * their consolidation batch record is repointed at the new section so batch
 * rollback still finds them.
 *
 * `down()` is a no-op: putting the pairs back behind the cap would only
 * re-strand them.
 */
type Entry = {
  id: string;
  status: string;
  provenance?: { source?: string };
  adjudication?: unknown;
} & Record<string, unknown>;

type Section = {
  id: string;
  languageId: number;
  sectionCode: string;
  injectionMode: string;
  status: string;
  entries: Entry[];
};

const TARGET_CODE = 'everyday_words';

export class RequeueMinedPairsOnDemand1973800000000 implements MigrationInterface {
  name = 'RequeueMinedPairsOnDemand1973800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const sections: Section[] = await queryRunner.query(
      `SELECT "id", "languageId", "sectionCode", "injectionMode", "status", "entries"
         FROM "language_glossary_sections"
        WHERE "profileId" IS NULL`,
    );
    const byLanguage = new Map<number, Section[]>();
    for (const s of sections) {
      byLanguage.set(s.languageId, [
        ...(byLanguage.get(s.languageId) ?? []),
        s,
      ]);
    }

    for (const [languageId, langSections] of byLanguage) {
      const stale = langSections
        .filter((s) => s.injectionMode === 'always')
        .map((s) => ({
          section: s,
          moving: (s.entries ?? []).filter(
            (e) =>
              e.status === 'proposed' &&
              e.provenance?.source === 'lexeme_mining',
          ),
        }))
        .filter((x) => x.moving.length > 0);
      if (stale.length === 0) continue;

      let target =
        langSections.find(
          (s) =>
            s.sectionCode === 'general_vocabulary' &&
            s.status === 'published' &&
            s.injectionMode === 'retrieved',
        ) ?? langSections.find((s) => s.sectionCode === TARGET_CODE);
      if (!target) {
        const [created]: Section[] = await queryRunner.query(
          `INSERT INTO "language_glossary_sections"
             ("languageId", "profileId", "sectionCode", "title", "content", "entries",
              "retrievalHint", "injectionMode", "status", "tierPinned", "version", "provenance")
           VALUES ($1, NULL, $2, 'Everyday words', '', '[]'::jsonb, $3,
                   'retrieved', 'published', true, 0, '{"source": "lexeme_mining"}'::jsonb)
           RETURNING "id", "languageId", "sectionCode", "injectionMode", "status", "entries"`,
          [
            languageId,
            TARGET_CODE,
            'Everyday spoken word choices: the colloquial word to use instead of a bookish or literary one.',
          ],
        );
        target = created;
      }

      const movedIds = new Set<string>();
      const incoming: Entry[] = [];
      for (const { section, moving } of stale) {
        for (const e of moving) {
          movedIds.add(e.id);
          // Fresh start for the adjudicator: the deferrals were the cap's, not
          // a judgement on the pair.
          const fresh: Entry = { ...e };
          delete fresh.adjudication;
          incoming.push(fresh);
        }
        await queryRunner.query(
          `UPDATE "language_glossary_sections"
              SET "entries" = $2::jsonb, "version" = "version" + 1, "updatedAt" = now()
            WHERE "id" = $1`,
          [
            section.id,
            JSON.stringify(section.entries.filter((e) => !movedIds.has(e.id))),
          ],
        );
      }
      await queryRunner.query(
        `UPDATE "language_glossary_sections"
            SET "entries" = COALESCE("entries", '[]'::jsonb) || $2::jsonb,
                "version" = "version" + 1, "updatedAt" = now()
          WHERE "id" = $1`,
        [target.id, JSON.stringify(incoming)],
      );

      const batches: { id: string; entries: Record<string, unknown>[] }[] =
        await queryRunner.query(
          `SELECT "id", "entries" FROM "glossary_consolidation_batches"
            WHERE "languageId" = $1 AND "trigger" = 'lexeme_mining'`,
          [languageId],
        );
      for (const batch of batches) {
        let changed = false;
        const entries = (batch.entries ?? []).map((be) => {
          if (!movedIds.has(String(be.entryId))) return be;
          changed = true;
          return {
            ...be,
            sectionId: target!.id,
            sectionCode: target!.sectionCode,
          };
        });
        if (changed) {
          await queryRunner.query(
            `UPDATE "glossary_consolidation_batches" SET "entries" = $2::jsonb WHERE "id" = $1`,
            [batch.id, JSON.stringify(entries)],
          );
        }
      }
    }
  }

  public async down(): Promise<void> {
    // Intentionally a no-op; see the class comment.
  }
}
