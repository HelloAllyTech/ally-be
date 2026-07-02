#!/usr/bin/env node
import { withDataSource, log } from './helpers';
import { seedTenant } from './seeders/tenant.seeder';
import { seedUsers } from './seeders/user.seeder';
import { seedVoices } from './seeders/voice.seeder';
import { seedSessionEvents } from './seeders/session-event.seeder';
import { seedScenarios } from './seeders/scenario.seeder';
import { seedCases } from './seeders/case.seeder';
import { seedSessions } from './seeders/session.seeder';
import { seedBadges } from './seeders/badge.seeder';
import { seedScenarioCoverImageLibrary } from './seeders/scenario-cover-image-library.seeder';
import { seedSimulationCredits } from './seeders/simulation-credits.seeder';
import { seedReviews } from './seeders/review.seeder';
import { seedScribeData } from './seeders/scribe.seeder';
import { User } from '../../user/entity/user.entity';
import { ADMIN_EMAIL, DEFAULT_OTP, DEFAULT_PASSWORD } from './config';

async function main(): Promise<void> {
  const started = Date.now();

  await withDataSource(async (ds) => {
    const tenant = await seedTenant(ds);
    await seedUsers(ds, tenant);

    const admin = await ds
      .getRepository(User)
      .findOneOrFail({ where: { email: ADMIN_EMAIL } });

    await seedVoices(ds);
    await seedSessionEvents(ds);
    await seedScenarios(ds, admin.id);
    await seedCases(ds, admin.id);
    await seedSessions(ds);
    await seedReviews(ds);
    await seedBadges(ds, admin.id);
    await seedScenarioCoverImageLibrary(ds, admin.id);
    await seedSimulationCredits(ds);
    await seedScribeData(ds, admin.id, tenant.id);
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
