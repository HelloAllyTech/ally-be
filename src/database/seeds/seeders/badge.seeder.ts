import { DataSource } from 'typeorm';
import { Badge } from '../../../badge/entity/badge.entity';
import { BadgeGroup } from '../../../badge/entity/badge-group.entity';
import { BadgeTenant } from '../../../badge/entity/badge-tenant.entity';
import { Group } from '../../../authorization/entity/group.entity';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { getRepo, log, upsert } from '../helpers';
import { badges, defaults } from '../fixtures';

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
        status: defaults.badgeStatus,
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
}
