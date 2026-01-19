import {
  GroupedUserAvailableBadges,
  UserAvailableBadge,
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
