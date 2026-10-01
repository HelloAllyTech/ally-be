import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switches the `product_roadmap_manage` toggle OFF for every admin except one.
 *
 * A one-way product decision (2026-10-01), shipped alongside moving "Open in Builder Agent" on a
 * roadmap card off this toggle and onto Builder access (the `builder` toggle + EDIT_BUILDER).
 * Until then the manage toggle carried two unrelated grants — curating the board, and starting
 * Builder sessions from it — so it had been handed out widely to give people the second. With the
 * Builder hand-off now following Builder access, manage goes back to the board's actual curators:
 * it is reset to the one kept account below and re-granted per-admin from Admin User Management.
 *
 * Builder grants are deliberately untouched. A current manage holder WITHOUT the `builder` toggle
 * loses the card's Builder icon here, by decision — giving them Builder would hand them the whole
 * Builder tab, not just the card hand-off.
 *
 * Rows are disabled (`enabled = false`), not deleted, so "this admin used to hold it" stays
 * visible on the row. Keyed on email, like 1828000000000-AddSuperDuperAdminRole; on a database
 * without that account (a fresh local seed) every holder is revoked, which is harmless there.
 *
 * NOT REVERSIBLE by `down()`: after the fact there is no telling the rows this disabled from rows
 * that were already off. The affected user ids are printed to the migration log for that reason —
 * restore from there, or re-grant from Admin User Management.
 *
 * NOTE: FeatureToggleService caches enabled keys under `admin:feature-toggles:${userId}` for 30
 * minutes and raw SQL cannot bust it. Revoked admins keep the manage controls until the TTL lapses,
 * or immediately after a `DEL` of that prefix.
 */
const FEATURE_KEY = 'product_roadmap_manage';
const KEEP_EMAIL = 'sandeep.malhotra@helloally.ai';

export class RevokeProductRoadmapManageToggle1975200000000 implements MigrationInterface {
  name = 'RevokeProductRoadmapManageToggle1975200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // TypeORM's postgres runner returns [rows, rowCount] for UPDATE ... RETURNING.
    const [revoked]: [Array<{ userId: number }>, number] =
      await queryRunner.query(
        `
        UPDATE "admin_feature_toggles" t
        SET "enabled" = false, "updatedBy" = NULL, "updatedAt" = now()
        WHERE t."featureKey" = $1
          AND t."enabled" = true
          AND NOT EXISTS (
            SELECT 1 FROM "users" u
            WHERE u.id = t."userId" AND lower(u.email) = lower($2)
          )
        RETURNING t."userId"
        `,
        [FEATURE_KEY, KEEP_EMAIL],
      );

    console.log(
      `[${this.name}] revoked ${FEATURE_KEY} from ${revoked.length} admin(s): ` +
        JSON.stringify(revoked.map((row) => row.userId)),
    );
  }

  public async down(): Promise<void> {
    // Deliberately a no-op — see "NOT REVERSIBLE" above.
  }
}
