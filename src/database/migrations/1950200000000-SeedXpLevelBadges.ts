import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a ladder of XP_LEVEL badges for the learner Progress dashboard.
 *
 * Levels and badges do different jobs and are deliberately not redundant: the level bar
 * shows linear progress — where you are on one road — while badges mark non-linear
 * achievements you can collect in any order. These sit at the seam, marking the moments
 * on the ladder worth keeping after the bar has moved past them.
 *
 * Rungs are sparse on purpose. A badge at every level would make each one worthless, and
 * the level bar already acknowledges every step. Only 2, 5, 8 and 10 are marked: the
 * first promotion, the mid-climb, the long haul, and the top.
 *
 * Deliberately NOT seeded here: practice-minute and streak ladders, which already exist
 * as SIMULATION_MINUTES and ACTIVE_DAY_STREAK badges. Duplicating them under a new
 * category would award two badges for one achievement.
 *
 * Idempotent by badge name, matching the streak ladder seed.
 */
const LEVEL_BADGES: {
  name: string;
  description: string;
  count: number;
}[] = [
  {
    name: 'Getting Going',
    description: 'Reach level 2 on your progress ladder.',
    count: 2,
  },
  {
    name: 'Halfway Up',
    description: 'Reach level 5 on your progress ladder.',
    count: 5,
  },
  {
    name: 'Seasoned',
    description: 'Reach level 8 on your progress ladder.',
    count: 8,
  },
  {
    name: 'Top of the Ladder',
    description: 'Reach level 10, the highest level.',
    count: 10,
  },
];

const LEARNER_GROUP_NAME = 'LEARNER';

export class SeedXpLevelBadges1950200000000 implements MigrationInterface {
  name = 'SeedXpLevelBadges1950200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // createdBy/updatedBy are NOT NULL. Attribute to the lowest existing user id, the
    // way the streak ladder seed does; with no users yet there is nothing to seed for.
    const [owner] = await queryRunner.query(
      `SELECT MIN(id)::int AS id FROM users`,
    );
    const ownerId = owner?.id;
    if (!ownerId) {
      return;
    }

    for (const badge of LEVEL_BADGES) {
      const inserted = await queryRunner.query(
        `
        INSERT INTO badges
          ("name", "description", "status", "visibilityType", "category",
           "achievementParams", "createdBy", "updatedBy", "createdAt", "updatedAt")
        SELECT $1::varchar, $2::text, 'ACTIVE', 'PUBLIC', 'XP_LEVEL',
               jsonb_build_object('count', $3::int), $4::int, $4::int, NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM badges WHERE "name" = $1::varchar AND "deletedAt" IS NULL
        )
        RETURNING id
        `,
        [badge.name, badge.description, badge.count, ownerId],
      );

      const badgeId = inserted?.[0]?.id;
      if (!badgeId) {
        // Already present — leave its group/tenant assignments alone.
        continue;
      }

      await queryRunner.query(
        `
        INSERT INTO badge_groups ("badgeId", "groupId", "createdAt", "updatedAt")
        SELECT $1, g.id, NOW(), NOW()
        FROM groups g
        WHERE g."name" = $2
        ON CONFLICT DO NOTHING
        `,
        [badgeId, LEARNER_GROUP_NAME],
      );

      // Assigned to every tenant so the badge exists everywhere; the Progress dashboard
      // itself stays gated by the PROGRESS_DASHBOARD_ENABLED org preference, so a tenant
      // without the feature simply never earns these.
      await queryRunner.query(
        `
        INSERT INTO badge_tenants ("badgeId", "tenantId", "createdAt")
        SELECT $1, t.id, NOW()
        FROM tenants t
        ON CONFLICT DO NOTHING
        `,
        [badgeId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const names = LEVEL_BADGES.map((b) => b.name);

    await queryRunner.query(
      `
      DELETE FROM badge_tenants
      WHERE "badgeId" IN (SELECT id FROM badges WHERE "name" = ANY($1::text[]))
      `,
      [names],
    );
    await queryRunner.query(
      `
      DELETE FROM badge_groups
      WHERE "badgeId" IN (SELECT id FROM badges WHERE "name" = ANY($1::text[]))
      `,
      [names],
    );
    await queryRunner.query(
      `
      DELETE FROM badge_users
      WHERE "badgeId" IN (SELECT id FROM badges WHERE "name" = ANY($1::text[]))
      `,
      [names],
    );
    await queryRunner.query(
      `DELETE FROM badges WHERE "name" = ANY($1::text[]) AND "category" = 'XP_LEVEL'`,
      [names],
    );
  }
}
