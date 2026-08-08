import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a ladder of ACTIVE_DAY_STREAK badges.
 *
 * Before this, exactly one streak badge existed ("Consistent Start", 3 days), so
 * the practice-streak UI's "next milestone" had nothing to point at once a user
 * passed day three. A streak is a sequenced mini-goal mechanic: it needs rungs
 * the whole way up, each one rewarded, or the progress ring goes dead after the
 * first week.
 *
 * Idempotent by badge name, so re-running is safe and an existing "Consistent
 * Start" is left exactly as it is.
 */
const STREAK_BADGES: {
  name: string;
  description: string;
  count: number;
}[] = [
  {
    name: 'Consistent Start',
    description: 'Build a 3-day active streak.',
    count: 3,
  },
  {
    name: 'Week One',
    description: 'Practise every day for a week.',
    count: 7,
  },
  {
    name: 'Fortnight Focus',
    description: 'Keep a 14-day active streak going.',
    count: 14,
  },
  {
    name: 'Monthly Momentum',
    description: 'Reach a 30-day active streak.',
    count: 30,
  },
  {
    name: 'Two Month Steady',
    description: 'Reach a 60-day active streak.',
    count: 60,
  },
  {
    name: 'Century Streak',
    description: 'Practise on 100 consecutive days.',
    count: 100,
  },
];

const LEARNER_GROUP_NAME = 'LEARNER';

export class SeedActiveDayStreakBadgeLadder1887000000000 implements MigrationInterface {
  name = 'SeedActiveDayStreakBadgeLadder1887000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // createdBy/updatedBy are NOT NULL. Attribute to the lowest existing user id
    // the way the seeder attributes to the admin user; if there are no users yet
    // the seeder will create these badges instead, so skip.
    const [owner] = await queryRunner.query(
      `SELECT MIN(id)::int AS id FROM users`,
    );
    const ownerId = owner?.id;
    if (!ownerId) {
      return;
    }

    for (const badge of STREAK_BADGES) {
      const inserted = await queryRunner.query(
        `
        INSERT INTO badges
          ("name", "description", "status", "visibilityType", "category",
           "achievementParams", "createdBy", "updatedBy", "createdAt", "updatedAt")
        SELECT $1::varchar, $2::text, 'ACTIVE', 'PUBLIC', 'ACTIVE_DAY_STREAK',
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

      // Visible to learners, matching the existing streak badge.
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

      // Available to every tenant, matching how badge.seeder.ts assigns badges.
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
    // "Consistent Start" predates this migration — it is seeded by
    // badge.seeder.ts, so leave it behind.
    const names = STREAK_BADGES.filter(
      (b) => b.name !== 'Consistent Start',
    ).map((b) => b.name);

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
      `DELETE FROM badges WHERE "name" = ANY($1::text[]) AND "category" = 'ACTIVE_DAY_STREAK'`,
      [names],
    );
  }
}
