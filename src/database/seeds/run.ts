#!/usr/bin/env node
import { withDataSource, log } from './helpers';
import { seedTenant } from './seeders/tenant.seeder';
import { seedUsers } from './seeders/user.seeder';
import { seedVoices } from './seeders/voice.seeder';
import { seedSessionEvents } from './seeders/session-event.seeder';
import { seedScenarios } from './seeders/scenario.seeder';
import { seedBadges } from './seeders/badge.seeder';
import { User } from '../../user/entity/user.entity';
import { ADMIN_EMAIL, DEFAULT_OTP, DEFAULT_PASSWORD } from './config';

async function main(): Promise<void> {
  const started = Date.now();

  await withDataSource(async (ds) => {
    await seedTenant(ds);
    await seedUsers(ds);

    const admin = await ds
      .getRepository(User)
      .findOneOrFail({ where: { email: ADMIN_EMAIL } });

    await seedVoices(ds);
    await seedSessionEvents(ds);
    await seedScenarios(ds, admin.id);
    await seedBadges(ds, admin.id);
  });

  log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  log('');
  log(
    `login: ${ADMIN_EMAIL} / password: ${DEFAULT_PASSWORD} / otp: ${DEFAULT_OTP}`,
  );
  log('other test users share the same password and OTP.');
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
