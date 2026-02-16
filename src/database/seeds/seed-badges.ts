import {
  createSeedDataSource,
  DEFAULT_TENANT_CODE_ENV,
  logStep,
} from './seed-utils';
import { Badge } from '../../badge/entity/badge.entity';
import { BadgeGroup } from '../../badge/entity/badge-group.entity';
import { BadgeTenant } from '../../badge/entity/badge-tenant.entity';
import { BadgeUser } from '../../badge/entity/badge-user.entity';
import { Tenant } from '../../tenant/entity/tenant.entity';
import {
  BadgeCategory,
  BadgeStatus,
  BadgeVisibilityType,
  BadgeViewedStatus,
} from '../../badge/constants/badge.constants';

// Group IDs for badge assignment
const GROUP_IDS = {
  LEARNER: 5,
  REVIEWER: 6,
};

// User IDs for badge_users seeding
const USER_IDS = [3, 5];

// Admin user ID for createdBy/updatedBy
const ADMIN_USER_ID = 1;

interface BadgeData {
  name: string;
  description: string;
  imageUrl: string;
  status: BadgeStatus;
  visibilityType: BadgeVisibilityType;
  category: BadgeCategory;
  achievementParams: { count: number };
}

// Badge definitions for all categories
const badgesData: BadgeData[] = [
  // ============================================
  // SIMULATION_MINUTES badges
  // ============================================
  {
    name: 'Simulation Starter',
    description: 'Complete your first 10 minutes of simulation practice.',
    imageUrl: 'https://placehold.co/200x200/4CAF50/white?text=10min',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.SIMULATION_MINUTES,
    achievementParams: { count: 10 },
  },
  {
    name: 'Simulation Enthusiast',
    description:
      'Reach 30 minutes of simulation time. You are building momentum!',
    imageUrl: 'https://placehold.co/200x200/2196F3/white?text=30min',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.SIMULATION_MINUTES,
    achievementParams: { count: 30 },
  },
  {
    name: 'Dedicated Practitioner',
    description:
      'Complete 60 minutes of simulation. Your commitment to learning is showing!',
    imageUrl: 'https://placehold.co/200x200/9C27B0/white?text=1hr',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.SIMULATION_MINUTES,
    achievementParams: { count: 60 },
  },
  {
    name: 'Simulation Veteran',
    description:
      'Achieve 120 minutes of simulation practice. You are becoming a seasoned counselor!',
    imageUrl: 'https://placehold.co/200x200/FF5722/white?text=2hr',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.SIMULATION_MINUTES,
    achievementParams: { count: 120 },
  },
  {
    name: 'Simulation Master',
    description:
      'Complete 300 minutes of simulation. You have demonstrated exceptional dedication!',
    imageUrl: 'https://placehold.co/200x200/FFD700/black?text=5hr',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.SIMULATION_MINUTES,
    achievementParams: { count: 300 },
  },

  // ============================================
  // ACTIVE_DAY_STREAK badges
  // ============================================
  {
    name: 'First Step',
    description:
      'Log in for 2 consecutive days. Every journey starts with consistency!',
    imageUrl: 'https://placehold.co/200x200/8BC34A/white?text=2+Days',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    achievementParams: { count: 2 },
  },
  {
    name: 'Week Warrior',
    description: 'Maintain a 7-day active streak. A full week of dedication!',
    imageUrl: 'https://placehold.co/200x200/00BCD4/white?text=7+Days',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    achievementParams: { count: 7 },
  },
  {
    name: 'Fortnight Focus',
    description:
      'Keep your streak going for 14 days. Your persistence is inspiring!',
    imageUrl: 'https://placehold.co/200x200/3F51B5/white?text=14+Days',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    achievementParams: { count: 14 },
  },
  {
    name: 'Monthly Milestone',
    description:
      'Achieve a 30-day streak. A full month of consistent learning!',
    imageUrl: 'https://placehold.co/200x200/E91E63/white?text=30+Days',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    achievementParams: { count: 30 },
  },
  {
    name: 'Unstoppable',
    description:
      'Maintain a 60-day streak. Your commitment to growth is extraordinary!',
    imageUrl: 'https://placehold.co/200x200/FF9800/black?text=60+Days',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.ACTIVE_DAY_STREAK,
    achievementParams: { count: 60 },
  },

  // ============================================
  // COMMENTS_REACTIONS_GIVEN badges
  // ============================================
  {
    name: 'First Voice',
    description:
      'Give your first comment or reaction. Your engagement matters!',
    imageUrl: 'https://placehold.co/200x200/607D8B/white?text=1',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
    achievementParams: { count: 1 },
  },
  {
    name: 'Conversation Starter',
    description:
      'Give 10 comments or reactions. You are actively contributing to the community!',
    imageUrl: 'https://placehold.co/200x200/795548/white?text=10',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
    achievementParams: { count: 10 },
  },
  {
    name: 'Active Contributor',
    description:
      'Give 25 comments or reactions. Your participation enriches our community!',
    imageUrl: 'https://placehold.co/200x200/009688/white?text=25',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
    achievementParams: { count: 25 },
  },
  {
    name: 'Community Pillar',
    description:
      'Give 50 comments or reactions. You are a cornerstone of our learning community!',
    imageUrl: 'https://placehold.co/200x200/673AB7/white?text=50',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
    achievementParams: { count: 50 },
  },
  {
    name: 'Engagement Champion',
    description:
      'Give 100 comments or reactions. Your dedication to helping others is remarkable!',
    imageUrl: 'https://placehold.co/200x200/F44336/white?text=100',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
    achievementParams: { count: 100 },
  },

  // ============================================
  // COMMENTS_REACTIONS_RECEIVED badges
  // ============================================
  {
    name: 'Getting Noticed',
    description:
      'Receive your first comment or reaction. Your contributions are being seen!',
    imageUrl: 'https://placehold.co/200x200/CDDC39/black?text=1',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
    achievementParams: { count: 1 },
  },
  {
    name: 'Rising Star',
    description:
      'Receive 10 comments or reactions. Others are appreciating your work!',
    imageUrl: 'https://placehold.co/200x200/FFC107/black?text=10',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
    achievementParams: { count: 10 },
  },
  {
    name: 'Crowd Favorite',
    description:
      'Receive 25 comments or reactions. Your insights resonate with the community!',
    imageUrl: 'https://placehold.co/200x200/FF5252/white?text=25',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
    achievementParams: { count: 25 },
  },
  {
    name: 'Influential Voice',
    description:
      'Receive 50 comments or reactions. You are making a real impact!',
    imageUrl: 'https://placehold.co/200x200/7C4DFF/white?text=50',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
    achievementParams: { count: 50 },
  },
  {
    name: 'Community Star',
    description:
      'Receive 100 comments or reactions. You are a true inspiration to others!',
    imageUrl: 'https://placehold.co/200x200/E040FB/white?text=100',
    status: BadgeStatus.ACTIVE,
    visibilityType: BadgeVisibilityType.PUBLIC,
    category: BadgeCategory.COMMENTS_REACTIONS_RECEIVED,
    achievementParams: { count: 100 },
  },
];

async function seedBadges() {
  const dataSource = createSeedDataSource(
    [Badge, BadgeGroup, BadgeTenant, BadgeUser, Tenant],
    false,
  );

  try {
    await dataSource.initialize();
    logStep('[badges] Database connection established');

    const badgeRepository = dataSource.getRepository(Badge);
    const badgeGroupRepository = dataSource.getRepository(BadgeGroup);
    const badgeTenantRepository = dataSource.getRepository(BadgeTenant);
    const badgeUserRepository = dataSource.getRepository(BadgeUser);
    const tenantRepository = dataSource.getRepository(Tenant);

    // Get the default tenant
    const tenant = await tenantRepository.findOne({
      where: { code: DEFAULT_TENANT_CODE_ENV },
    });

    if (!tenant) {
      console.error(
        `[badges] Tenant with code "${DEFAULT_TENANT_CODE_ENV}" not found. Please run user-tenant seed first.`,
      );
      process.exit(1);
    }

    logStep(`[badges] Found tenant: ${tenant.name} (${tenant.id})`);

    // Track created badges for badge_users seeding
    const createdBadgeIds: string[] = [];
    let skippedCount = 0;
    let createdCount = 0;

    // Create badges
    for (const badgeData of badgesData) {
      // Check if badge already exists
      const existingBadge = await badgeRepository.findOne({
        where: { name: badgeData.name },
      });

      if (existingBadge) {
        logStep(
          `[badges] Badge "${badgeData.name}" already exists, skipping...`,
        );
        createdBadgeIds.push(existingBadge.id);
        skippedCount++;
        continue;
      }

      // Create badge
      const badge = badgeRepository.create({
        ...badgeData,
        createdBy: ADMIN_USER_ID,
        updatedBy: ADMIN_USER_ID,
      });

      const savedBadge = await badgeRepository.save(badge);
      createdBadgeIds.push(savedBadge.id);
      createdCount++;

      // Create badge_groups entries for LEARNER and REVIEWER
      for (const groupId of Object.values(GROUP_IDS)) {
        const existingBadgeGroup = await badgeGroupRepository.findOne({
          where: { badgeId: savedBadge.id, groupId },
        });

        if (!existingBadgeGroup) {
          const badgeGroup = badgeGroupRepository.create({
            badgeId: savedBadge.id,
            groupId,
          });
          await badgeGroupRepository.save(badgeGroup);
        }
      }

      // Create badge_tenants entry
      const existingBadgeTenant = await badgeTenantRepository.findOne({
        where: { badgeId: savedBadge.id, tenantId: tenant.id },
      });

      if (!existingBadgeTenant) {
        const badgeTenant = badgeTenantRepository.create({
          badgeId: savedBadge.id,
          tenantId: tenant.id,
        });
        await badgeTenantRepository.save(badgeTenant);
      }
    }

    logStep(
      `[badges] Created ${createdCount} badges, skipped ${skippedCount} existing`,
    );

    // Create badge_groups and badge_tenants for existing badges (if they were skipped)
    for (const badgeId of createdBadgeIds) {
      // Ensure badge_groups exist
      for (const groupId of Object.values(GROUP_IDS)) {
        const existingBadgeGroup = await badgeGroupRepository.findOne({
          where: { badgeId, groupId },
        });

        if (!existingBadgeGroup) {
          const badgeGroup = badgeGroupRepository.create({
            badgeId,
            groupId,
          });
          await badgeGroupRepository.save(badgeGroup);
        }
      }

      // Ensure badge_tenant exists
      const existingBadgeTenant = await badgeTenantRepository.findOne({
        where: { badgeId, tenantId: tenant.id },
      });

      if (!existingBadgeTenant) {
        const badgeTenant = badgeTenantRepository.create({
          badgeId,
          tenantId: tenant.id,
        });
        await badgeTenantRepository.save(badgeTenant);
      }
    }

    logStep(`[badges] Badge groups and tenants assigned`);

    // Assign some badges to users (first few badges for each user)
    // User 3 gets first 3 badges, User 5 gets first 5 badges
    const userBadgeAssignments = [
      { userId: USER_IDS[0], badgeCount: 3 }, // User 3 gets 3 badges
      { userId: USER_IDS[1], badgeCount: 5 }, // User 5 gets 5 badges
    ];

    let userBadgesCreated = 0;
    for (const assignment of userBadgeAssignments) {
      const badgesToAssign = createdBadgeIds.slice(0, assignment.badgeCount);

      for (const badgeId of badgesToAssign) {
        const existingBadgeUser = await badgeUserRepository.findOne({
          where: { userId: assignment.userId, badgeId },
        });

        if (!existingBadgeUser) {
          const badgeUser = badgeUserRepository.create({
            userId: assignment.userId,
            badgeId,
            viewedStatus: BadgeViewedStatus.UNVIEWED,
          });
          await badgeUserRepository.save(badgeUser);
          userBadgesCreated++;
        }
      }
    }

    logStep(
      `[badges] Assigned ${userBadgesCreated} badges to users ${USER_IDS.join(', ')}`,
    );

    // Summary by category
    const categoryCounts: Record<string, number> = {};
    badgesData.forEach((badge) => {
      categoryCounts[badge.category] =
        (categoryCounts[badge.category] || 0) + 1;
    });

    logStep('[badges] Badge summary by category:');
    Object.entries(categoryCounts).forEach(([category, count]) => {
      logStep(`[badges]   ✓ ${category}: ${count} badges`);
    });

    logStep('[badges] ✅ Badge seeding completed successfully!');
  } catch (error) {
    console.error('[badges] Error seeding badges:', error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

seedBadges();
