#!/usr/bin/env node
import { withDataSource, log } from './helpers';
import { seedTenants } from './seeders/tenant.seeder';
import { seedUsers } from './seeders/user.seeder';
import { seedVoices } from './seeders/voice.seeder';
import { seedSessionEvents } from './seeders/session-event.seeder';
import { seedLearnCatalog } from './seeders/learn-catalog.seeder';
import { seedScenarios } from './seeders/scenario.seeder';
import { seedTracks } from './seeders/track.seeder';
import { seedCases } from './seeders/case.seeder';
import { seedSessions } from './seeders/session.seeder';
import { seedBadges } from './seeders/badge.seeder';
import { seedScenarioCoverImageLibrary } from './seeders/scenario-cover-image-library.seeder';
import { seedSimulationCredits } from './seeders/simulation-credits.seeder';
import { seedReviews } from './seeders/review.seeder';
import { seedScribeData } from './seeders/scribe.seeder';
import { seedRoadmap } from './seeders/roadmap.seeder';
import { seedLab } from './seeders/lab.seeder';
import { User } from '../../user/entity/user.entity';
import { ADMIN_EMAIL, DEFAULT_OTP, DEFAULT_PASSWORD } from './config';

async function main(): Promise<void> {
  const started = Date.now();

  await withDataSource(async (ds) => {
    const tenants = await seedTenants(ds);
    await seedUsers(ds, tenants);

    const admin = await ds
      .getRepository(User)
      .findOneOrFail({ where: { email: ADMIN_EMAIL } });

    await seedVoices(ds);
    await seedSessionEvents(ds);
    await seedLearnCatalog(ds, admin.id);
    await seedScenarios(ds, admin.id);
    await seedCases(ds, admin.id);
    await seedTracks(ds, admin.id);
    await seedSessions(ds);
    await seedReviews(ds);
    await seedBadges(ds, admin.id);
    await seedScenarioCoverImageLibrary(ds, admin.id);
    await seedSimulationCredits(ds);
    await seedScribeData(ds, admin.id, tenants[0].id);
    await seedRoadmap(ds, admin.id);
    await seedLab(ds, admin.id);
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
