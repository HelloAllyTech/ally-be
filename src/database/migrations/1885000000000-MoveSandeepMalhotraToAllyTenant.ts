import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves sandeep.malhotra@helloally.ai onto the `ally` tenant (the internal /
 * default organization, keyed by tenants.code = 'ally').
 *
 * Keyed on email, idempotent (re-running just re-assigns the same tenant_id),
 * and a no-op if the account or the `ally` tenant is absent — safe to run
 * everywhere.
 *
 * down() is intentionally a no-op: the user's prior tenant_id isn't known
 * ahead of time and isn't captured anywhere a migration can read it back from.
 * up() logs the previous tenant_id before overwriting it — if this needs to
 * be reverted, use that logged value to restore it manually.
 *
 * NOTE: tenant membership is cached in Redis (`user:groups:<id>`, etc. — see
 * 1876000000000). The user may need to sign out/in or wait out the TTL to see
 * the change take effect.
 */
const EMAIL = 'sandeep.malhotra@helloally.ai';
const TENANT_CODE = 'ally';

export class MoveSandeepMalhotraToAllyTenant1885000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const before: Array<{ tenant_id: string | null }> = await queryRunner.query(
      `SELECT tenant_id FROM "users" WHERE email = $1`,
      [EMAIL],
    );

    if (before.length === 0) {
      console.log(
        `[MoveSandeepMalhotraToAllyTenant] NO SUCH USER (${EMAIL}) in this database — no-op.`,
      );
      return;
    }

    console.log(
      `[MoveSandeepMalhotraToAllyTenant] ${EMAIL}: previous tenant_id = ${before[0].tenant_id ?? '(none)'}`,
    );

    const result = await queryRunner.query(
      `
      UPDATE "users"
         SET tenant_id = (
           SELECT id::text FROM "tenants" WHERE code = $2 AND "deletedAt" IS NULL
         )
       WHERE email = $1
         AND EXISTS (SELECT 1 FROM "tenants" WHERE code = $2 AND "deletedAt" IS NULL)
      `,
      [EMAIL, TENANT_CODE],
    );

    // node-postgres returns { rowCount } as the second element for UPDATE.
    const rowCount = Array.isArray(result) ? result[1] : undefined;
    if (!rowCount) {
      console.log(
        `[MoveSandeepMalhotraToAllyTenant] tenant with code='${TENANT_CODE}' not found (or soft-deleted) — no-op.`,
      );
      return;
    }

    await this.reportAssignment(queryRunner);
  }

  public async down(): Promise<void> {
    console.log(
      `[MoveSandeepMalhotraToAllyTenant] down() is a no-op — see the previous tenant_id logged by up() and restore it manually if needed.`,
    );
  }

  private async reportAssignment(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{
      email: string;
      tenant_id: string;
      organization: string;
      isTestOrganization: boolean;
    }> = await queryRunner.query(
      `
        SELECT u.email, u.tenant_id, t.name AS organization, t."isTestOrganization"
          FROM "users" u
          JOIN "tenants" t ON t.id::text = u.tenant_id
         WHERE u.email = $1
        `,
      [EMAIL],
    );

    if (rows.length === 0) {
      console.log(
        `[MoveSandeepMalhotraToAllyTenant] ${EMAIL}: post-update lookup returned no row.`,
      );
    } else {
      const r = rows[0];
      console.log(
        `[MoveSandeepMalhotraToAllyTenant] ${r.email}: tenant_id=${r.tenant_id} organization=${r.organization} isTestOrganization=${r.isTestOrganization}`,
      );
    }
  }
}
