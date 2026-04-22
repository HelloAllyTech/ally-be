#!/usr/bin/env node
import { withDataSource, log } from './helpers';
import { DB } from './config';

const TABLES_IN_ORDER = [
  'badge_users',
  'badge_tenants',
  'badge_groups',
  'badges',
  'case_tenants',
  'case_items',
  'cases',
  'scenario_path_tenants',
  'scenario_path_items',
  'scenario_paths',
  'scenario_tenants',
  'scenarios',
  'session_events',
  'scenario_voices',
  'user_groups',
  'users',
  'tenants',
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('[seed:reset] refusing to run in production.');
    process.exit(1);
  }

  const confirmed =
    process.argv.includes('--confirm') ||
    process.env.SEED_RESET_CONFIRM === '1';

  if (!confirmed) {
    console.error(
      `[seed:reset] this will TRUNCATE seeded tables in "${DB.database}". ` +
        `pass --confirm (or SEED_RESET_CONFIRM=1) to proceed.`,
    );
    process.exit(1);
  }

  log(`truncating seeded tables in "${DB.database}"...`);

  await withDataSource(async (ds) => {
    const list = TABLES_IN_ORDER.map((t) => `"${t}"`).join(', ');
    await ds.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  });

  log('reset complete.');
}

main().catch((err) => {
  console.error('[seed:reset] failed:', err);
  process.exit(1);
});
