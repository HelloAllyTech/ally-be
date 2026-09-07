import { DataSource } from 'typeorm';
import { Badge } from '../../../badge/entity/badge.entity';
import { BadgeGroup } from '../../../badge/entity/badge-group.entity';
import { BadgeTenant } from '../../../badge/entity/badge-tenant.entity';
import { BadgeUser } from '../../../badge/entity/badge-user.entity';
import { BadgeViewedStatus } from '../../../badge/constants/badge.constants';
import { Group } from '../../../authorization/entity/group.entity';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { User } from '../../../user/entity/user.entity';
import { getRepo, log, upsert } from '../helpers';
import { badges, earnedBadges, defaults } from '../fixtures';

const daysAgo = (n: number): Date =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000);

export async function seedBadges(
  ds: DataSource,
  adminUserId: number,
): Promise<void> {
  const badgeRepo = getRepo(ds, Badge);
  const badgeGroupRepo = getRepo(ds, BadgeGroup);
  const badgeTenantRepo = getRepo(ds, BadgeTenant);
  const groupRepo = getRepo(ds, Group);
  const tenantRepo = getRepo(ds, Tenant);

  const groupIdByName = new Map(
    (await groupRepo.find()).map((g) => [g.name, g.id]),
  );
  const tenants = await tenantRepo.find();

  for (const fixture of badges) {
    const badge = await upsert(
      badgeRepo,
      { name: fixture.name },
      {
        description: fixture.description,
        status: fixture.status ?? defaults.badgeStatus,
        visibilityType: defaults.badgeVisibility,
        category: fixture.category,
        achievementParams: { count: fixture.count },
        createdBy: adminUserId,
        updatedBy: adminUserId,
      },
    );

    for (const role of fixture.groupNames) {
      const groupId = groupIdByName.get(role);
      if (!groupId) continue;
      await upsert(
        badgeGroupRepo,
        { badgeId: badge.id, groupId },
        { badgeId: badge.id, groupId },
      );
    }

    for (const tenant of tenants) {
      await upsert(
        badgeTenantRepo,
        { badgeId: badge.id, tenantId: tenant.id },
        { badgeId: badge.id, tenantId: tenant.id },
      );
    }
  }
  log(`badges: ${badges.length}`);

  await seedEarnedBadges(ds);
}

async function seedEarnedBadges(ds: DataSource): Promise<void> {
  const badgeRepo = getRepo(ds, Badge);
  const badgeUserRepo = getRepo(ds, BadgeUser);
  const userRepo = getRepo(ds, User);

  const badgeIdByName = new Map(
    (await badgeRepo.find()).map((b) => [b.name, b.id]),
  );
  const userIdByEmail = new Map(
    (await userRepo.find()).map((u) => [u.email, u.id]),
  );

  let created = 0;
  let skipped = 0;
  for (const fixture of earnedBadges) {
    const badgeId = badgeIdByName.get(fixture.badgeName);
    const userId = userIdByEmail.get(fixture.email);
    if (!badgeId || !userId) {
      skipped++;
      continue;
    }

    const existing = await badgeUserRepo.findOne({
      where: { userId, badgeId },
    });
    if (existing) continue;

    const created_ = badgeUserRepo.create({
      userId,
      badgeId,
      viewedStatus:
        fixture.viewed === false
          ? BadgeViewedStatus.UNVIEWED
          : BadgeViewedStatus.VIEWED,
      createdAt: daysAgo(fixture.earnedDaysAgo),
    });
    await badgeUserRepo.save(created_);
    created++;
  }

  log(
    `earned badges: ${created} created, ${skipped} skipped (missing user/badge)`,
  );
}
