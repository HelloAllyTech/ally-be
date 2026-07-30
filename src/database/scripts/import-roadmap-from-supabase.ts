/**
 * One-off import of the standalone roadmap app's Supabase data into ally-be's roadmap_* tables.
 *
 *   npm run migration:roadmap-import -- --dir=<snapshot> --dry-run
 *   npm run migration:roadmap-import -- --dir=<snapshot> --create-missing-users --allow-user-creation --tenant-id=<uuid>
 *
 * THIS IS A THIN WRAPPER. All of the logic — the single transaction, the uuid-preserving load, the
 * user mapping and the 16 verification checks — lives in
 * `src/product-roadmap/import/roadmap-import.core.ts`, shared with
 * `POST /v1/product-roadmap/admin/import`. This file's only job is to turn a snapshot FOLDER into
 * the in-memory snapshot the core expects, and to print the result.
 *
 * Use the CLI when you have a host that can reach production Postgres (bastion, tunnel, one-off
 * task). Use the endpoint when you do not — it runs inside deployed ally-be, which already can, and
 * avoids moving a snapshot containing user-interview transcripts between machines.
 *
 * WHY A SNAPSHOT AND NOT A DIRECT SUPABASE READ: `SUPABASE_SERVICE_ROLE_KEY` is a PostgREST JWT,
 * not a Postgres password, so pg_dump was never available. The snapshot is also the audit artefact
 * the verification checks compare against — see `manifest.json`, which records the source counts
 * and `sum(coins)` at extract time.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import AppDataSource from '../data-source';
import {
  RoadmapSnapshot,
  runRoadmapImport,
} from '../../product-roadmap/import/roadmap-import.core';

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const SNAPSHOT_DIR = flag('dir');

if (!SNAPSHOT_DIR) {
  console.error('FATAL: --dir=<snapshot directory> is required');
  process.exit(1);
}

const read = <T>(file: string, fallback?: T): T => {
  const path = resolve(SNAPSHOT_DIR, file);
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Snapshot is missing ${file}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
};

/**
 * Read the snapshot folder into one object.
 *
 * Field names match the file names exactly, so there is no translation layer here to get wrong —
 * the same shape is what the upload endpoint receives as a bundle.
 */
const loadSnapshotFromDisk = (): RoadmapSnapshot => ({
  manifest: read('manifest.json'),
  app_users: read('app_users.json'),
  product_goals: read('product_goals.json'),
  opportunity_owners: read('opportunity_owners.json'),
  opportunities: read('opportunities.json'),
  allocations: read('allocations.json'),
  opportunity_comments: read('opportunity_comments.json'),
  interview_notes: read('interview_notes.json'),
  // The source shipped release notes but nobody used them, so real snapshots have 0 rows.
  release_notes: read('release_notes.json', []),
  saved_views: read('saved_views.json', []),
  user_tab_order: read('user_tab_order.json', []),
});

async function main(): Promise<void> {
  const snapshot = loadSnapshotFromDisk();
  console.log(`\nSnapshot: ${SNAPSHOT_DIR}`);

  const dataSource = await AppDataSource.initialize();
  try {
    const result = await runRoadmapImport(dataSource, snapshot, {
      // `--dry-run` present means dry run; absent means commit. The core defaults to a dry run, so
      // this has to be explicit rather than passed through as `has('dry-run')`.
      dryRun: has('dry-run'),
      createMissingUsers: has('create-missing-users'),
      allowUserCreation: has('allow-user-creation'),
      tenantId: flag('tenant-id'),
    });

    for (const line of result.log) console.log(line);

    if (result.failedChecks.length > 0) {
      console.error(
        `\nFAILED — transaction rolled back, database untouched.\n` +
          result.failedChecks
            .map(
              (c) =>
                `  ✗ ${c.check}: expected=${c.expected} actual=${c.actual}`,
            )
            .join('\n') +
          '\n',
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`\nFAILED — transaction rolled back, database untouched.`);
    console.error(`  ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await dataSource.destroy();
  }
}

void main();
