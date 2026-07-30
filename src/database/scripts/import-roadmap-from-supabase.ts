/**
 * One-off import of the standalone roadmap app's Supabase data into ally-be's roadmap_* tables.
 *
 * Reads a snapshot produced by sandeep-roadmap-app/scripts/export-for-ally.mjs.
 *
 *   npm run migration:roadmap-import -- --dir=<snapshot> --dry-run
 *   npm run migration:roadmap-import -- --dir=<snapshot> --create-missing-users --allow-user-creation --tenant-id=<uuid>
 *
 * ── DESIGN NOTES ────────────────────────────────────────────────────────────────────────────
 *
 * NOT a TypeORM migration, deliberately. `migrationsRun: true` fires migrations at boot in every
 * environment, so a data import inside one would run in CI and on every developer's laptop,
 * could not be re-run against a corrected snapshot, and a failure would block app startup.
 *
 * ONE TRANSACTION. Either the whole board lands or nothing does; there is no partial state to
 * reason about.
 *
 * IDEMPOTENT via preserved primary keys — every insert is ON CONFLICT DO UPDATE. Re-running
 * against the same snapshot is a no-op; re-running against a newer one applies the delta. That
 * is what makes the cutover's final delta load safe.
 *
 * UUIDs ARE PRESERVED for opportunities, comments, interview notes, release notes and saved
 * views, because `/opportunity/:id` share links and `release_notes.opportunityIds` depend on
 * them. Goals and owners deliberately do NOT preserve their source uuids: nothing references
 * them by id (the FK is by NAME, and saved-view state stores names too), and migration …002 has
 * already seeded the same taxonomy.
 *
 * VERIFICATION IS PART OF THE LOAD, not a follow-up step. The assertions run inside the same
 * transaction and abort it on failure — most importantly total coins, which is the entire
 * priority signal.
 */

import { DataSource, EntityManager } from 'typeorm';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import AppDataSource from '../data-source';

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const SNAPSHOT_DIR = flag('dir');
const DRY_RUN = has('dry-run');
const CREATE_MISSING_USERS = has('create-missing-users');
const ALLOW_USER_CREATION = has('allow-user-creation');
const TENANT_ID = flag('tenant-id');

if (!SNAPSHOT_DIR) {
  console.error('FATAL: --dir=<snapshot directory> is required');
  process.exit(1);
}

// ── snapshot types (source shapes, snake_case) ───────────────────────────────
interface SourceUser {
  id: string;
  email: string;
  role: string;
  created_at: string;
}
interface SourceTaxonomy {
  id: string;
  name: string;
  position: number;
  created_at: string;
}
interface SourceOpportunity {
  id: string;
  description: string;
  type: string;
  stage: string;
  product_goal: string;
  owner: string | null;
  prd: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  released_at: string | null;
}
interface SourceAllocation {
  user_id: string;
  opportunity_id: string;
  period_key: string;
  coins: number;
}
interface SourceComment {
  id: string;
  opportunity_id: string;
  user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}
interface SourceInterviewNote {
  id: string;
  title: string;
  interviewee: string | null;
  transcript: string | null;
  summary: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}
interface SourceReleaseNote {
  id: string;
  title: string | null;
  content: string;
  opportunity_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}
interface SourceSavedView {
  id: string;
  name: string;
  state: Record<string, unknown>;
  created_by: string;
  pinned: boolean;
  created_at: string;
}
interface SourceTabOrder {
  user_id: string;
  view_ids: string[];
}
interface Manifest {
  projectRef: string;
  extractedAt: string;
  tables: Record<string, number>;
  totalCoins: number;
  allocationRows: number;
  coinsByUserPeriod: Record<string, number>;
  priorityScores: Record<string, number>;
}

const read = <T>(file: string, fallback?: T): T => {
  const path = resolve(SNAPSHOT_DIR!, file);
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Snapshot is missing ${file}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
};

const log = (message: string) => console.log(message);
const fail = (message: string): never => {
  throw new Error(message);
};

// ── user mapping ─────────────────────────────────────────────────────────────
/**
 * Map Supabase app_users.id (uuid) → ally users.id (int), by email.
 *
 * MISSING-EMAIL POLICY: create the Ally user.
 *
 * Mapping unmatched voters onto a shared placeholder was rejected outright, not merely as lossy:
 * roadmap_allocations is unique on (userId, opportunityId, periodKey), so two source voters
 * funnelled into one placeholder who both voted on the same opportunity in the same month would
 * MERGE into a single row — coins would silently vanish and the ≤100 cap could be breached.
 * Aborting instead was also rejected: it makes the migration hostage to whether a departed
 * colleague still has an account, and their historical votes are legitimate roadmap history.
 *
 * User creation is gated behind BOTH --create-missing-users and --allow-user-creation, is the
 * only step that writes outside the roadmap_* namespace, and stamps createdByMigration = true so
 * the set stays exactly enumerable forever.
 */
async function buildUserMap(
  manager: EntityManager,
  sourceUsers: SourceUser[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const toCreate: SourceUser[] = [];

  for (const user of sourceUsers) {
    const email = user.email?.trim();
    if (!email)
      fail(
        `Source user ${user.id} has no email; cannot map it to an Ally user`,
      );

    const rows = await manager.query<{ id: number }[]>(
      // Ally emails are stored lowercased; compare case-insensitively so a differently-cased
      // source address still matches rather than triggering a spurious user creation.
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );

    if (rows.length > 0) {
      map.set(user.id, rows[0].id);
    } else {
      toCreate.push(user);
    }
  }

  if (toCreate.length > 0) {
    log(`\n  ${toCreate.length} source user(s) have no Ally account:`);
    for (const user of toCreate) log(`      ${user.email} (role=${user.role})`);

    if (!CREATE_MISSING_USERS || !ALLOW_USER_CREATION) {
      fail(
        `Refusing to continue. Re-run with --create-missing-users --allow-user-creation ` +
          `--tenant-id=<uuid> to create them, or invite them in Ally first. Skipping them is not ` +
          `an option: their allocations are the priority signal.`,
      );
    }
    if (!TENANT_ID) {
      fail(
        '--tenant-id=<uuid> is required when creating users. Never guess the tenant.',
      );
    }

    for (const user of toCreate) {
      const email = user.email.trim().toLowerCase();
      // Mirrors UserService.bulkAddUsers.
      const inserted = await manager.query<{ id: number }[]>(
        `INSERT INTO users (email, name, username, status, tenant_id, "profileCompleted", metadata)
              VALUES ($1, '', $1, 'ACTIVE', $2, false, $3::jsonb)
         RETURNING id`,
        [email, TENANT_ID, JSON.stringify({ source: 'roadmap-migration' })],
      );
      map.set(user.id, inserted[0].id);
      log(`      created Ally user ${inserted[0].id} for ${email}`);
    }
  }

  // Persist the decision log. sourceEmailLower is UNIQUE, so a case-collision between two source
  // accounts surfaces as a loud constraint violation inside this transaction rather than as a
  // silent merge of two people's votes.
  for (const user of sourceUsers) {
    const allyUserId = map.get(user.id)!;
    const createdByMigration = toCreate.some((u) => u.id === user.id);
    await manager.query(
      `INSERT INTO roadmap_user_map
         ("sourceUserId","sourceEmail","sourceEmailLower","sourceRole","allyUserId","createdByMigration")
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ("sourceUserId") DO UPDATE SET
         "sourceEmail" = EXCLUDED."sourceEmail",
         "sourceEmailLower" = EXCLUDED."sourceEmailLower",
         "sourceRole" = EXCLUDED."sourceRole",
         "allyUserId" = EXCLUDED."allyUserId",
         "updatedAt" = now()`,
      [
        user.id,
        user.email,
        user.email.trim().toLowerCase(),
        user.role,
        allyUserId,
        createdByMigration,
      ],
    );
  }

  return map;
}

// ── load ─────────────────────────────────────────────────────────────────────
async function load(manager: EntityManager): Promise<void> {
  const users = read<SourceUser[]>('app_users.json');
  const goals = read<SourceTaxonomy[]>('product_goals.json');
  const owners = read<SourceTaxonomy[]>('opportunity_owners.json');
  const opportunities = read<SourceOpportunity[]>('opportunities.json');
  const allocations = read<SourceAllocation[]>('allocations.json');
  const comments = read<SourceComment[]>('opportunity_comments.json');
  const interviews = read<SourceInterviewNote[]>('interview_notes.json');
  const releaseNotes = read<SourceReleaseNote[]>('release_notes.json', []);
  const savedViews = read<SourceSavedView[]>('saved_views.json', []);
  const tabOrders = read<SourceTabOrder[]>('user_tab_order.json', []);

  log('\n── mapping users ──');
  const userMap = await buildUserMap(manager, users);
  const allyUser = (sourceId: string): number =>
    userMap.get(sourceId) ??
    fail(
      `Source user ${sourceId} is not in the user map — refusing to drop their rows`,
    );

  // FK targets first: opportunities reference goals and owners BY NAME.
  //
  // UPSERT ON NAME, not on id, and do NOT try to preserve the source uuids. Nothing references
  // them — opportunities carry the goal/owner NAME (that is the whole point of the FK-by-name
  // design) and saved-view state stores names too. Migration …002 has already seeded the same
  // taxonomy under different uuids, so conflicting on `name` keeps the seeded row and just syncs
  // the display order.
  //
  // This must be a real ON CONFLICT clause rather than a try/catch: in Postgres a failed
  // statement aborts the ENTIRE transaction, so catching the error in JS and carrying on leaves
  // every subsequent statement failing with "current transaction is aborted".
  log('\n── loading taxonomy ──');
  for (const goal of goals) {
    await manager.query(
      `INSERT INTO roadmap_product_goals (name, position, "createdAt")
            VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET position = EXCLUDED.position`,
      [goal.name, goal.position ?? 0, goal.created_at],
    );
  }
  for (const owner of owners) {
    await manager.query(
      `INSERT INTO roadmap_opportunity_owners (name, position, "createdAt")
            VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET position = EXCLUDED.position`,
      [owner.name, owner.position ?? 0, owner.created_at],
    );
  }
  log(`  goals: ${goals.length}, owners: ${owners.length}`);

  log('\n── loading opportunities ──');
  for (const opportunity of opportunities) {
    await manager.query(
      `INSERT INTO roadmap_opportunities
         (id, description, type, stage, "productGoal", owner, prd, "releasedAt",
          "createdBy", "updatedBy", "createdAt", "updatedAt", "embeddingStatus")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,'pending')
       ON CONFLICT (id) DO UPDATE SET
         description = EXCLUDED.description, type = EXCLUDED.type, stage = EXCLUDED.stage,
         "productGoal" = EXCLUDED."productGoal", owner = EXCLUDED.owner, prd = EXCLUDED.prd,
         -- releasedAt is copied verbatim and NEVER regenerated. Only 107 of 280 released rows
         -- carry one, because the source trigger also fired only on transition.
         "releasedAt" = EXCLUDED."releasedAt", "updatedAt" = EXCLUDED."updatedAt"`,
      [
        opportunity.id,
        opportunity.description,
        opportunity.type,
        opportunity.stage,
        opportunity.product_goal,
        opportunity.owner,
        opportunity.prd,
        opportunity.released_at,
        allyUser(opportunity.created_by),
        opportunity.created_at,
        opportunity.updated_at,
      ],
    );
  }
  log(`  opportunities: ${opportunities.length}`);

  log('\n── loading allocations (the priority signal) ──');
  for (const allocation of allocations) {
    await manager.query(
      `INSERT INTO roadmap_allocations ("userId","opportunityId","periodKey",coins)
            VALUES ($1,$2,$3,$4)
       ON CONFLICT ("userId","opportunityId","periodKey") DO UPDATE SET coins = EXCLUDED.coins`,
      [
        allyUser(allocation.user_id),
        allocation.opportunity_id,
        allocation.period_key,
        allocation.coins,
      ],
    );
  }
  log(`  allocations: ${allocations.length}`);

  log('\n── loading comments, notes and views ──');
  for (const comment of comments) {
    await manager.query(
      `INSERT INTO roadmap_opportunity_comments
         (id, "opportunityId", body, "createdBy", "updatedBy", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, "updatedAt" = EXCLUDED."updatedAt"`,
      [
        comment.id,
        comment.opportunity_id,
        comment.body,
        allyUser(comment.user_id),
        comment.created_at,
        comment.updated_at,
      ],
    );
  }
  for (const note of interviews) {
    await manager.query(
      `INSERT INTO roadmap_interview_notes
         (id, title, interviewee, transcript, summary, "createdBy", "updatedBy", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, interviewee = EXCLUDED.interviewee,
         transcript = EXCLUDED.transcript, summary = EXCLUDED.summary,
         "updatedAt" = EXCLUDED."updatedAt"`,
      [
        note.id,
        note.title,
        note.interviewee,
        note.transcript,
        note.summary,
        allyUser(note.created_by),
        note.created_at,
        note.updated_at,
      ],
    );
  }
  for (const note of releaseNotes) {
    await manager.query(
      `INSERT INTO roadmap_release_notes
         (id, title, content, "opportunityIds", "createdBy", "updatedBy", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4::uuid[],$5,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, content = EXCLUDED.content,
         "opportunityIds" = EXCLUDED."opportunityIds", "updatedAt" = EXCLUDED."updatedAt"`,
      [
        note.id,
        note.title,
        note.content,
        note.opportunity_ids ?? [],
        allyUser(note.created_by),
        note.created_at,
        note.updated_at,
      ],
    );
  }
  for (const view of savedViews) {
    await manager.query(
      // saved_views has no updated_at in the source (confirmed drift), so createdAt is reused.
      `INSERT INTO roadmap_saved_views
         (id, name, state, pinned, "createdBy", "updatedBy", "createdAt", "updatedAt")
       VALUES ($1,$2,$3::jsonb,$4,$5,$5,$6,$6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, state = EXCLUDED.state, pinned = EXCLUDED.pinned`,
      [
        view.id,
        view.name,
        JSON.stringify(view.state ?? {}),
        view.pinned ?? false,
        allyUser(view.created_by),
        view.created_at,
      ],
    );
  }
  for (const order of tabOrders) {
    await manager.query(
      `INSERT INTO roadmap_user_tab_order ("userId","viewIds")
            VALUES ($1,$2::uuid[])
       ON CONFLICT ("userId") DO UPDATE SET "viewIds" = EXCLUDED."viewIds", "updatedAt" = now()`,
      [allyUser(order.user_id), order.view_ids ?? []],
    );
  }
  log(
    `  comments: ${comments.length}, interviews: ${interviews.length}, ` +
      `releaseNotes: ${releaseNotes.length}, views: ${savedViews.length}, tabOrders: ${tabOrders.length}`,
  );
}

// ── verification, inside the transaction ─────────────────────────────────────
/**
 * Every check is pass/fail and a failure aborts the transaction. These are the assertions that
 * make the load trustworthy — particularly V2, which is the whole point of the exercise.
 */
async function verify(
  manager: EntityManager,
  manifest: Manifest,
): Promise<void> {
  const results: {
    check: string;
    expected: string;
    actual: string;
    ok: boolean;
  }[] = [];
  const record = (check: string, expected: unknown, actual: unknown) =>
    results.push({
      check,
      expected: String(expected),
      actual: String(actual),
      ok: String(expected) === String(actual),
    });

  const scalar = async (
    sql: string,
    params: unknown[] = [],
  ): Promise<string> => {
    const rows = await manager.query<Record<string, unknown>[]>(sql, params);
    return String(Object.values(rows[0] ?? {})[0] ?? '');
  };

  // V1 — per-table row-count parity against the manifest.
  const tableMap: Record<string, string> = {
    product_goals: 'roadmap_product_goals',
    opportunity_owners: 'roadmap_opportunity_owners',
    opportunities: 'roadmap_opportunities',
    allocations: 'roadmap_allocations',
    opportunity_comments: 'roadmap_opportunity_comments',
    interview_notes: 'roadmap_interview_notes',
    release_notes: 'roadmap_release_notes',
    saved_views: 'roadmap_saved_views',
    user_tab_order: 'roadmap_user_tab_order',
  };
  for (const [source, target] of Object.entries(tableMap)) {
    const expected = manifest.tables[source] ?? 0;
    // Goals/owners can legitimately EXCEED the source count on a seeded database, because
    // migration …002 seeds the same taxonomy. Assert at-least for those, exact for the rest.
    const actual = await scalar(`SELECT COUNT(*) FROM ${target}`);
    if (source === 'product_goals' || source === 'opportunity_owners') {
      record(`V1 ${source} >= source`, true, Number(actual) >= expected);
    } else {
      record(`V1 ${source} rows`, expected, actual);
    }
  }

  // V2 — TOTAL COINS CONSERVED. The single most important assertion. Exact equality, no tolerance.
  const totalCoins = await scalar(
    `SELECT COALESCE(SUM(coins),0) FROM roadmap_allocations`,
  );
  record('V2 TOTAL COINS', manifest.totalCoins, totalCoins);

  // V2b — conserved per (user, period) too. An aggregate-only check would pass even if two
  // people's coins had swapped.
  const perUserPeriod = await manager.query<
    { email: string; periodKey: string; total: string }[]
  >(
    `SELECT m."sourceUserId" AS email, a."periodKey" AS "periodKey", SUM(a.coins)::text AS total
       FROM roadmap_allocations a
       JOIN roadmap_user_map m ON m."allyUserId" = a."userId"
      GROUP BY 1,2`,
  );
  let perUserPeriodMismatches = 0;
  for (const row of perUserPeriod) {
    const expected =
      manifest.coinsByUserPeriod?.[`${row.email}|${row.periodKey}`];
    if (expected === undefined || String(expected) !== row.total)
      perUserPeriodMismatches++;
  }
  record('V2b per (user,period) sums', 0, perUserPeriodMismatches);

  // V3 — the cap invariant holds, or the trigger will reject that user's next write.
  const breaches = await scalar(
    `SELECT COUNT(*) FROM (
       SELECT "userId","periodKey" FROM roadmap_allocations
        GROUP BY 1,2 HAVING SUM(coins) > 100) b`,
  );
  record('V3 cap breaches', 0, breaches);

  // V4 — PRIORITY-SCORE PARITY. Same all-users-all-periods sum on both sides.
  const scores = await manager.query<{ id: string; score: string }[]>(
    `SELECT o.id, COALESCE(SUM(a.coins),0)::text AS score
       FROM roadmap_opportunities o
       LEFT JOIN roadmap_allocations a ON a."opportunityId" = o.id
      GROUP BY o.id`,
  );
  let scoreMismatches = 0;
  for (const row of scores) {
    const expected = manifest.priorityScores?.[row.id] ?? 0;
    if (String(expected) !== row.score) scoreMismatches++;
  }
  record('V4 priority scores match', 0, scoreMismatches);

  // V5 — every productGoal and owner resolves (the FK would have blocked otherwise, but assert
  // it explicitly so a future ON DELETE change cannot pass silently).
  record(
    'V5 unresolved goals',
    0,
    await scalar(
      `SELECT COUNT(*) FROM roadmap_opportunities o
        WHERE NOT EXISTS (SELECT 1 FROM roadmap_product_goals g WHERE g.name = o."productGoal")`,
    ),
  );

  // V6 — comment counts per opportunity.
  record(
    'V6 comments attached',
    manifest.tables.opportunity_comments ?? 0,
    await scalar(
      `SELECT COUNT(*) FROM roadmap_opportunity_comments c
        WHERE EXISTS (SELECT 1 FROM roadmap_opportunities o WHERE o.id = c."opportunityId")`,
    ),
  );

  // V7 — releasedAt preserved. Asserts PRESERVATION, not completeness: most released rows
  // legitimately have a NULL releasedAt.
  const sourceOpportunities = read<SourceOpportunity[]>('opportunities.json');
  const expectedReleasedAt = sourceOpportunities.filter(
    (o) => o.released_at,
  ).length;
  record(
    'V7 releasedAt preserved',
    expectedReleasedAt,
    await scalar(
      `SELECT COUNT(*) FROM roadmap_opportunities WHERE "releasedAt" IS NOT NULL`,
    ),
  );

  // ── report ──
  log('\n── verification ──');
  const width = Math.max(...results.map((r) => r.check.length));
  for (const result of results) {
    log(
      `  ${result.ok ? '✓' : '✗'} ${result.check.padEnd(width)}  expected=${result.expected}  actual=${result.actual}`,
    );
  }
  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    fail(
      `${failures.length} verification check(s) FAILED — rolling the transaction back. ` +
        `The database is untouched.`,
    );
  }
  log('\n  all checks passed');
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const manifest = read<Manifest>('manifest.json');
  log(`\nSnapshot: ${SNAPSHOT_DIR}`);
  log(`  project ${manifest.projectRef}, extracted ${manifest.extractedAt}`);
  log(
    `  expecting ${manifest.allocationRows} allocations / ${manifest.totalCoins} coins`,
  );
  if (DRY_RUN) log('\n  *** DRY RUN — the transaction will be rolled back ***');

  const dataSource: DataSource = await AppDataSource.initialize();
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    await queryRunner.query(`SET LOCAL statement_timeout = '5min'`);
    await load(queryRunner.manager);
    await verify(queryRunner.manager, manifest);

    if (DRY_RUN) {
      await queryRunner.rollbackTransaction();
      log(
        '\nDRY RUN complete — rolled back. Re-run without --dry-run to commit.\n',
      );
    } else {
      await queryRunner.commitTransaction();
      log('\nCOMMITTED.');
      log(
        'Next: POST /api/v1/product-roadmap/admin/reindex to build the Weaviate index.\n',
      );
    }
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error(`\nFAILED — transaction rolled back, database untouched.`);
    console.error(`  ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
}

void main();
