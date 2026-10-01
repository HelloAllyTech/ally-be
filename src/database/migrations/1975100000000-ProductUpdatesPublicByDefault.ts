import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes existing internal product updates public, to match the new default.
 *
 * Until 2026-10-01 an update was internal unless a customer could see it, and
 * staff-tool work was forced internal by code. The rule is now the reverse:
 * anything of value to anyone — Ally's own team included, and reliability and
 * bug-fix work above all — is public, and internal is kept for work of no
 * value. New updates follow the new prompt; this brings the old ones in line.
 *
 * Left alone:
 *  - an audience a person set (`edited_fields` holds `audience`): their call
 *    stands;
 *  - hidden updates, which a person withdrew;
 *  - updates the job could not place (`model IS NULL`), whose text is a raw
 *    commit subject and was never written for a reader.
 *
 * A flipped update that is already live gets `published_at = live_at`, the
 * same rule the liveness pass applies: it keeps the update out of the
 * consolidation job's "recently published, still open" window, so its text is
 * not rewritten by the next follow-up merge just because it moved.
 *
 * The team digest keys on `announced_live`, not the audience, so nothing here
 * is announced again.
 */
export class ProductUpdatesPublicByDefault1975100000000 implements MigrationInterface {
  name = 'ProductUpdatesPublicByDefault1975100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "product_updates"
      SET
        "audience" = 'public',
        "published_at" = COALESCE("published_at", "live_at")
      WHERE "audience" = 'internal'
        AND "hidden" = false
        AND "deletedAt" IS NULL
        AND "model" IS NOT NULL
        AND NOT ('audience' = ANY("edited_fields"))
    `);
  }

  /**
   * Not reversible: which rows this flipped is not recorded, and after the
   * deploy a person may have set some of them back by hand. Re-hide or
   * re-classify from the admin console's Product updates table instead.
   */
  public async down(): Promise<void> {
    // Intentionally empty — see above.
  }
}
