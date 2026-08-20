import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cohorts: a tenant admin's own MECE partition of their users, plus the
 * per-content restrictions that narrow a tenant-assigned item to some of those
 * cohorts.
 *
 * The two-layer model, and why this layer is subtractive
 * -----------------------------------------------------
 * Layer 1 already exists: `scenario_tenants` / `track_tenants` / `case_tenants`
 * decide what a *tenant* has at all, and everything in them is visible to every
 * user of that tenant. That default does not change here. Layer 2 (this
 * migration) lets a tenant admin optionally say "…except this one is only for
 * these cohorts". An item with **no** restriction rows stays visible to
 * everyone, so a tenant that never opens the Cohorts tab sees no behaviour
 * change whatsoever, and nothing needs backfilling at deploy.
 *
 * The alternative — making cohort assignment mandatory once a cohort exists —
 * was rejected because creating your first cohort would empty every learner's
 * catalog until the admin finished assigning.
 *
 * MECE is enforced in the database, not in the service
 * ---------------------------------------------------
 * `tenant_cohort_members_user_uq` is a partial UNIQUE on `userId` alone (live
 * rows only). One user, at most one cohort — a concurrent double-move can only
 * ever produce a constraint violation, never a user who is quietly in two
 * cohorts and therefore sees the union of two restriction sets. Membership is
 * moved by soft-deleting the old row and inserting the new one inside one
 * transaction.
 *
 * NULL `cohortId` is the "Unassigned" bucket
 * -----------------------------------------
 * Users with no membership row are a real, targetable audience: a restriction
 * row with `cohortId IS NULL` means "also visible to whoever is in no cohort".
 * Representing that as NULL rather than as a system cohort row per tenant is
 * deliberate — a system row is one more thing that must be created for every
 * new tenant, and a tenant that somehow missed it would silently lose the
 * ability to target its unplaced users. NULL cannot go missing. The cost is
 * paid here, in two partial unique indexes per table instead of one, because
 * Postgres treats NULLs as distinct and a plain UNIQUE would happily accept
 * duplicate "unassigned" rows.
 *
 * Three restriction tables, not one polymorphic table
 * --------------------------------------------------
 * `scenarios.id` is an integer while `tracks.id` and `cases.id` are uuids. A
 * single table would need `contentId varchar` and therefore a cast on every
 * join in the three hottest learner queries in the product — the same
 * `tenant_id::text` trap already documented elsewhere in this schema. Three
 * narrow tables keep every join typed, and they mirror the shape of the
 * `*_tenants` tables they sit beside.
 *
 * Permissions: `view:cohorts` / `edit:cohorts` go to the tenant ADMIN, whose
 * endpoints are all additionally pinned by OwnTenantScopeGuard. Note what is
 * NOT granted: `view:users`. The cohort member list is served by the cohort
 * controller under `view:cohorts` and returns only id/name/email/cohort for the
 * caller's own tenant, so a tenant admin never gains the platform-wide user
 * management endpoint just to be able to put people in cohorts.
 */
const COHORT_PERMISSIONS = ['view:cohorts', 'edit:cohorts'];

/**
 * Groups that get the new permissions. ADMIN is the tenant admin this feature
 * is for; the platform tiers are included so a super admin managing a tenant on
 * its behalf (the admin console's org-detail Cohorts tab) is not locked out of
 * a surface they are meant to support.
 */
const GRANTEE_GROUPS = [
  'ADMIN',
  'SUPER_ADMIN',
  'SUPER_DUPER_ADMIN',
  'MULTI_TENANT_ADMIN',
  'PLATFORM_ADMIN',
];

async function grantToGroup(
  queryRunner: QueryRunner,
  groupName: string,
  permissionNames: string[],
): Promise<void> {
  const group = await queryRunner.query(
    `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
    [groupName],
  );
  const groupId = group?.[0]?.id;
  if (!groupId) return;

  for (const name of permissionNames) {
    const perm = await queryRunner.query(
      `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
      [name],
    );
    const permId = perm?.[0]?.id;
    if (!permId) continue;

    const existingGrant = await queryRunner.query(
      `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
      [groupId, permId],
    );
    if (existingGrant.length === 0) {
      await queryRunner.query(
        `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
        [groupId, permId],
      );
    }
  }
}

async function revokeFromGroup(
  queryRunner: QueryRunner,
  groupName: string,
  permissionNames: string[],
): Promise<void> {
  const group = await queryRunner.query(
    `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
    [groupName],
  );
  const groupId = group?.[0]?.id;
  if (!groupId) return;

  for (const name of permissionNames) {
    await queryRunner.query(
      `DELETE FROM group_permissions
         WHERE "groupId" = $1
           AND "permissionId" = (SELECT id FROM "permissions" WHERE name = $2)`,
      [groupId, name],
    );
  }
}

/**
 * The three restriction tables differ only in the content-id column, so they
 * are generated from one shape rather than written out three times.
 */
const RESTRICTION_TABLES = [
  {
    table: 'scenario_cohort_restrictions',
    column: 'scenarioId',
    type: 'integer',
  },
  { table: 'track_cohort_restrictions', column: 'trackId', type: 'uuid' },
  { table: 'case_cohort_restrictions', column: 'caseId', type: 'uuid' },
];

export class CreateTenantCohorts1925000000000 implements MigrationInterface {
  name = 'CreateTenantCohorts1925000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_cohorts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "tenantId" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "description" text,
        CONSTRAINT "PK_tenant_cohorts" PRIMARY KEY ("id")
      )
    `);

    // Case-insensitive: "Night Shift" and "night shift" are the same cohort to
    // an admin reading the list, so letting both exist would make the partition
    // look non-MECE even though the data underneath is fine.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "tenant_cohorts_tenant_name_uq"
        ON "tenant_cohorts" ("tenantId", lower("name"))
        WHERE "deletedAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "tenant_cohorts_tenant_idx"
        ON "tenant_cohorts" ("tenantId")
        WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_cohort_members" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "cohortId" uuid NOT NULL,
        "userId" integer NOT NULL,
        "tenantId" uuid NOT NULL,
        CONSTRAINT "PK_tenant_cohort_members" PRIMARY KEY ("id"),
        CONSTRAINT "FK_tenant_cohort_members_cohort"
          FOREIGN KEY ("cohortId") REFERENCES "tenant_cohorts"("id") ON DELETE CASCADE
      )
    `);

    // This index IS the MECE guarantee — see the header note. Deliberately on
    // "userId" alone, not ("userId", "cohortId").
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "tenant_cohort_members_user_uq"
        ON "tenant_cohort_members" ("userId")
        WHERE "deletedAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "tenant_cohort_members_cohort_idx"
        ON "tenant_cohort_members" ("cohortId")
        WHERE "deletedAt" IS NULL
    `);

    for (const { table, column, type } of RESTRICTION_TABLES) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS "${table}" (
          "id" uuid NOT NULL DEFAULT gen_random_uuid(),
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          "deletedAt" TIMESTAMP,
          "${column}" ${type} NOT NULL,
          "cohortId" uuid,
          "tenantId" uuid NOT NULL,
          CONSTRAINT "PK_${table}" PRIMARY KEY ("id"),
          CONSTRAINT "FK_${table}_cohort"
            FOREIGN KEY ("cohortId") REFERENCES "tenant_cohorts"("id") ON DELETE CASCADE
        )
      `);

      // Two partial uniques rather than one: Postgres considers NULLs distinct,
      // so ("<content>", "cohortId", "tenantId") alone would let the same
      // "unassigned" restriction be inserted repeatedly.
      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "${table}_cohort_uq"
          ON "${table}" ("${column}", "tenantId", "cohortId")
          WHERE "deletedAt" IS NULL AND "cohortId" IS NOT NULL
      `);
      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "${table}_unassigned_uq"
          ON "${table}" ("${column}", "tenantId")
          WHERE "deletedAt" IS NULL AND "cohortId" IS NULL
      `);

      // The learner read path asks "does this item have ANY live restriction for
      // my tenant, and if so is one of them mine?" — both halves hit this index.
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "${table}_lookup_idx"
          ON "${table}" ("tenantId", "${column}")
          WHERE "deletedAt" IS NULL
      `);
    }

    for (const name of COHORT_PERMISSIONS) {
      const existing = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [name],
      );
      if (existing.length === 0) {
        await queryRunner.query(
          `INSERT INTO "permissions" (name) VALUES ($1)`,
          [name],
        );
      }
    }

    for (const group of GRANTEE_GROUPS) {
      await grantToGroup(queryRunner, group, COHORT_PERMISSIONS);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const group of GRANTEE_GROUPS) {
      await revokeFromGroup(queryRunner, group, COHORT_PERMISSIONS);
    }
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name = ANY($1::text[])`,
      [COHORT_PERMISSIONS],
    );

    for (const { table } of RESTRICTION_TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_cohort_members"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_cohorts"`);
  }
}
