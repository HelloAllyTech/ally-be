import {
  createSeedDataSource,
  DEFAULT_TENANT_CODE_ENV,
  logStep,
} from './seed-utils';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Badge } from '../../badge/entity/badge.entity';
import { BadgeGroup } from '../../badge/entity/badge-group.entity';
import { BadgeTenant } from '../../badge/entity/badge-tenant.entity';
import { BadgeUser } from '../../badge/entity/badge-user.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import {
  BadgeCategory,
  BadgeStatus,
  BadgeViewedStatus,
  BadgeVisibilityType,
} from '../../badge/constants/badge.constants';
import { Group } from '../../authorization/entity/group.entity';
import { User } from '../../user/entity/user.entity';
import { BadgeSeedData } from './badges.seed-data';

const BADGE_DATA_FILE = resolve(__dirname, './data/badges.json');
const ADMIN_USER_ID = 1;

interface BadgeData {
  name: string;
  description: string;
  imageUrl: string;
  status: BadgeStatus;
  visibilityType: BadgeVisibilityType;
  category: BadgeCategory;
  achievementParams: { count: number };
  translations?: Record<string, any> | null;
  groupNames: string[];
  tenantCodes: string[];
  userAssignments: Array<{
    email: string;
    viewedStatus: BadgeViewedStatus;
  }>;
}

const fallbackBadgesData: BadgeData[] = [
  {
    name: 'Simulation Starter',
    description: 'Complete your first 10 minutes of simulation practice.',
    imageUrl: 'https://placehold.co/200x200/4CAF50/white?text=10min',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.SIMULATION_MINUTES,
    achievementParams: { count: 10 },
    groupNames: ['LEARNER', 'SIMULATION_REVIEWER'],
    tenantCodes: [DEFAULT_TENANT_CODE_ENV],
    userAssignments: [],
  },
];

function loadBadgeSeedData(): BadgeSeedData {
  if (!existsSync(BADGE_DATA_FILE)) {
    logStep(
      `[badges] Seed data file not found at ${BADGE_DATA_FILE}. Falling back to built-in badge data.`,
    );
    return {
      source: {
        generatedAt: new Date(0).toISOString(),
        database: 'fallback',
        badgeCount: fallbackBadgesData.length,
      },
      badges: fallbackBadgesData,
    };
  }

  const raw = readFileSync(BADGE_DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw) as BadgeSeedData;
  logStep(
    `[badges] Loaded badge dataset from ${BADGE_DATA_FILE} (${parsed.badges.length} badges)`,
  );
  return parsed;
}

async function seedBadges() {
  const dataSource = createSeedDataSource(
    [Badge, BadgeGroup, BadgeTenant, BadgeUser, Tenant, Group, User],
    false,
  );

  try {
    await dataSource.initialize();
    logStep('[badges] Database connection established');

    const badgeSeedData = loadBadgeSeedData();

    const badgeRepository = dataSource.getRepository(Badge);
    const badgeGroupRepository = dataSource.getRepository(BadgeGroup);
    const badgeTenantRepository = dataSource.getRepository(BadgeTenant);
    const badgeUserRepository = dataSource.getRepository(BadgeUser);
    const tenantRepository = dataSource.getRepository(Tenant);
    const groupRepository = dataSource.getRepository(Group);
    const userRepository = dataSource.getRepository(User);

    const tenants = await tenantRepository.find();
    const tenantByCode = new Map(
      tenants.map((tenant) => [tenant.code, tenant]),
    );

    const groups = await groupRepository.find();
    const groupIdByName = new Map(
      groups.map((group) => [group.name, group.id]),
    );

    const users = await userRepository.find({
      select: ['id', 'email'],
    });
    const userIdByEmail = new Map(users.map((user) => [user.email, user.id]));

    let createdCount = 0;
    let skippedCount = 0;
    let groupLinksCreated = 0;
    let tenantLinksCreated = 0;
    let userLinksCreated = 0;

    for (const badgeData of badgeSeedData.badges) {
      let badge = await badgeRepository.findOne({
        where: { name: badgeData.name },
      });

      if (!badge) {
        badge = await badgeRepository.save(
          badgeRepository.create({
            name: badgeData.name,
            description: badgeData.description || undefined,
            imageUrl: badgeData.imageUrl || undefined,
            status: badgeData.status,
            visibilityType: badgeData.visibilityType,
            category: badgeData.category,
            achievementParams: badgeData.achievementParams || undefined,
            translations: badgeData.translations || undefined,
            createdBy: ADMIN_USER_ID,
            updatedBy: ADMIN_USER_ID,
          }),
        );
        createdCount++;
      } else {
        skippedCount++;
      }

      for (const groupName of badgeData.groupNames || []) {
        const groupId = groupIdByName.get(groupName);
        if (!groupId) {
          logStep(`[badges] Group "${groupName}" not found. Skipping mapping.`);
          continue;
        }

        const existingBadgeGroup = await badgeGroupRepository.findOne({
          where: { badgeId: badge.id, groupId },
        });
        if (!existingBadgeGroup) {
          await badgeGroupRepository.save(
            badgeGroupRepository.create({
              badgeId: badge.id,
              groupId,
            }),
          );
          groupLinksCreated++;
        }
      }

      for (const tenantCode of badgeData.tenantCodes || []) {
        const tenant = tenantByCode.get(tenantCode);
        if (!tenant) {
          logStep(
            `[badges] Tenant with code "${tenantCode}" not found. Skipping badge tenant mapping for "${badge.name}".`,
          );
          continue;
        }

        const existingBadgeTenant = await badgeTenantRepository.findOne({
          where: { badgeId: badge.id, tenantId: tenant.id },
        });
        if (!existingBadgeTenant) {
          await badgeTenantRepository.save(
            badgeTenantRepository.create({
              badgeId: badge.id,
              tenantId: tenant.id,
            }),
          );
          tenantLinksCreated++;
        }
      }

      for (const assignment of badgeData.userAssignments || []) {
        const userId = userIdByEmail.get(assignment.email);
        if (!userId) {
          logStep(
            `[badges] User "${assignment.email}" not found. Skipping badge assignment for "${badge.name}".`,
          );
          continue;
        }

        const existingBadgeUser = await badgeUserRepository.findOne({
          where: { userId, badgeId: badge.id },
        });
        if (!existingBadgeUser) {
          await badgeUserRepository.save(
            badgeUserRepository.create({
              userId,
              badgeId: badge.id,
              viewedStatus: assignment.viewedStatus,
            }),
          );
          userLinksCreated++;
        }
      }
    }

    logStep(
      `[badges] Created ${createdCount} badges, skipped ${skippedCount} existing`,
    );
    logStep(`[badges] Created ${groupLinksCreated} badge-group mappings`);
    logStep(`[badges] Created ${tenantLinksCreated} badge-tenant mappings`);
    logStep(`[badges] Created ${userLinksCreated} badge-user mappings`);
    logStep('[badges] ✅ Badge seeding completed successfully!');
  } catch (error) {
    console.error('[badges] Error seeding badges:', error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

seedBadges();
