import { groupAndSortBadgesByCategory } from '../badge.util';
import { UserAvailableBadge } from '../../type/badge-response.type';
import {
  BadgeCategory,
  BadgeLockStatus,
  BadgeViewedStatus,
} from '../../constants/badge.constants';

describe('Badge Util', () => {
  describe('groupAndSortBadgesByCategory', () => {
    const createBadge = (
      overrides: Partial<UserAvailableBadge> = {},
    ): UserAvailableBadge => ({
      id: 'badge-1',
      name: 'Test Badge',
      description: 'Test Description',
      imageUrl: 'https://example.com/badge.png',
      category: BadgeCategory.SIMULATION_MINUTES,
      achievementParams: { count: 10 },
      viewedStatus: BadgeViewedStatus.UNVIEWED,
      lockStatus: BadgeLockStatus.LOCKED,
      ...overrides,
    });

    it('should return empty array when given empty badges array', () => {
      const result = groupAndSortBadgesByCategory([]);

      expect(result).toEqual([]);
    });

    it('should group badges by category', () => {
      const badges: UserAvailableBadge[] = [
        createBadge({
          id: 'badge-1',
          category: BadgeCategory.SIMULATION_MINUTES,
        }),
        createBadge({
          id: 'badge-2',
          category: BadgeCategory.ACTIVE_DAY_STREAK,
        }),
        createBadge({
          id: 'badge-3',
          category: BadgeCategory.SIMULATION_MINUTES,
        }),
      ];

      const result = groupAndSortBadgesByCategory(badges);

      expect(result).toHaveLength(2);

      const simulationGroup = result.find(
        (g) => g.category === BadgeCategory.SIMULATION_MINUTES,
      );
      const streakGroup = result.find(
        (g) => g.category === BadgeCategory.ACTIVE_DAY_STREAK,
      );

      expect(simulationGroup?.badges).toHaveLength(2);
      expect(streakGroup?.badges).toHaveLength(1);
    });

    it('should sort badges within each category by achievementParams.count ascending', () => {
      const badges: UserAvailableBadge[] = [
        createBadge({
          id: 'badge-high',
          category: BadgeCategory.SIMULATION_MINUTES,
          achievementParams: { count: 100 },
        }),
        createBadge({
          id: 'badge-low',
          category: BadgeCategory.SIMULATION_MINUTES,
          achievementParams: { count: 10 },
        }),
        createBadge({
          id: 'badge-mid',
          category: BadgeCategory.SIMULATION_MINUTES,
          achievementParams: { count: 50 },
        }),
      ];

      const result = groupAndSortBadgesByCategory(badges);

      expect(result).toHaveLength(1);
      expect(result[0].badges).toHaveLength(3);
      expect(result[0].badges[0].achievementParams?.count).toBe(10);
      expect(result[0].badges[1].achievementParams?.count).toBe(50);
      expect(result[0].badges[2].achievementParams?.count).toBe(100);
    });

    it('should handle badges with null achievementParams count by treating it as 0', () => {
      const badges: UserAvailableBadge[] = [
        createBadge({
          id: 'badge-with-count',
          category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
          achievementParams: { count: 3 },
        }),
        createBadge({
          id: 'badge-null-count',
          category: BadgeCategory.COMMENTS_REACTIONS_GIVEN,
          achievementParams: { count: null } as any,
        }),
      ];

      const result = groupAndSortBadgesByCategory(badges);

      expect(result).toHaveLength(1);
      expect(result[0].badges[0].id).toBe('badge-null-count');
      expect(result[0].badges[1].id).toBe('badge-with-count');
    });

    it('should group and sort badges across multiple categories', () => {
      const badges: UserAvailableBadge[] = [
        createBadge({
          id: 'sim-30',
          category: BadgeCategory.SIMULATION_MINUTES,
          achievementParams: { count: 30 },
        }),
        createBadge({
          id: 'streak-7',
          category: BadgeCategory.ACTIVE_DAY_STREAK,
          achievementParams: { count: 7 },
        }),
        createBadge({
          id: 'sim-10',
          category: BadgeCategory.SIMULATION_MINUTES,
          achievementParams: { count: 10 },
        }),
        createBadge({
          id: 'streak-3',
          category: BadgeCategory.ACTIVE_DAY_STREAK,
          achievementParams: { count: 3 },
        }),
        createBadge({
          id: 'sim-60',
          category: BadgeCategory.SIMULATION_MINUTES,
          achievementParams: { count: 60 },
        }),
      ];

      const result = groupAndSortBadgesByCategory(badges);

      expect(result).toHaveLength(2);

      const simulationGroup = result.find(
        (g) => g.category === BadgeCategory.SIMULATION_MINUTES,
      );
      const streakGroup = result.find(
        (g) => g.category === BadgeCategory.ACTIVE_DAY_STREAK,
      );

      expect(simulationGroup?.badges.map((b) => b.id)).toEqual([
        'sim-10',
        'sim-30',
        'sim-60',
      ]);
      expect(streakGroup?.badges.map((b) => b.id)).toEqual([
        'streak-3',
        'streak-7',
      ]);
    });

    it('should maintain stable sort for badges with equal count', () => {
      const badges: UserAvailableBadge[] = [
        createBadge({
          id: 'badge-a',
          category: BadgeCategory.SIMULATION_MINUTES,
          achievementParams: { count: 10 },
        }),
        createBadge({
          id: 'badge-b',
          category: BadgeCategory.SIMULATION_MINUTES,
          achievementParams: { count: 10 },
        }),
        createBadge({
          id: 'badge-c',
          category: BadgeCategory.SIMULATION_MINUTES,
          achievementParams: { count: 10 },
        }),
      ];

      const result = groupAndSortBadgesByCategory(badges);

      expect(result).toHaveLength(1);
      expect(result[0].badges).toHaveLength(3);
      // All have the same count, so original order should be preserved (stable sort)
      expect(result[0].badges.map((b) => b.id)).toEqual([
        'badge-a',
        'badge-b',
        'badge-c',
      ]);
    });
  });
});
