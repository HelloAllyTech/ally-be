#!/usr/bin/env node
import { withDataSource, log } from '../seeds/helpers';
import { seedTenants } from '../seeds/seeders/tenant.seeder';
import { seedUsers } from '../seeds/seeders/user.seeder';

async function main(): Promise<void> {
  await withDataSource(async (ds) => {
    const tenants = await seedTenants(ds);
    await seedUsers(ds, tenants);
  });
  log('bootstrap admin done');
}

main().catch((err) => {
  console.error('[bootstrap] failed:', err);
  process.exit(1);
});
