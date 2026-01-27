import {
  GroupedUserAvailableBadges,
  UserAvailableBadge,
  UserBadgeWithDetails,
} from '../type/badge-response.type';
import { BadgeCategory } from '../constants/badge.constants';

/**
 * Groups badges by category and sorts them by achievementParams.count (ascending)
 */
export function groupAndSortBadgesByCategory(
  badges: UserAvailableBadge[],
): GroupedUserAvailableBadges[] {
  // Group badges by category
  const groupedByCategory = badges.reduce(
    (acc, badge) => {
      const category = badge.category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(badge);
      return acc;
    },
    {} as Record<string, UserAvailableBadge[]>,
  );

  // Sort badges within each category by achievementParams.count (ascending)
  // and convert to array format
  return Object.entries(groupedByCategory).map(
    ([category, categoryBadges]) => ({
      category: category as BadgeCategory,
      badges: categoryBadges.sort((a, b) => {
        const countA = a.achievementParams?.count ?? 0;
        const countB = b.achievementParams?.count ?? 0;
        return countA - countB;
      }),
    }),
  );
}

export function filterInvalidBadges(
  badges: UserBadgeWithDetails[],
  countMap: { userId: number; count: number }[],
): UserBadgeWithDetails[] {
  // Create a Map for O(1) lookup instead of O(n) find operations
  const countMapByUserId = new Map(
    countMap.map((item) => [item.userId, item.count]),
  );

  return badges.filter((badge) => {
    const actualCount = countMapByUserId.get(badge.userId) ?? 0;
    return (
      badge.achievementParams?.count &&
      badge.achievementParams?.count > actualCount
    );
  });
}
