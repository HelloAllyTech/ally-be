import {
  BadgeCategory,
  BadgeLockStatus,
  BadgeViewedStatus,
  BadgeVisibilityType,
} from '../constants/badge.constants';
import { BadgeAchievementParams } from './badge.type';

export interface UserBadgeWithDetails {
  id: string;
  badgeId: string;
  userId: number;
  viewedStatus: BadgeViewedStatus;
  createdAt: Date;
  name: string;
  description?: string;
  imageUrl?: string;
  category?: BadgeCategory;
  achievementParams?: BadgeAchievementParams;
}

export interface UserBadgeResponse {
  data: UserBadgeWithDetails[];
}

export interface TenantBadgeResponse {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  category: BadgeCategory;
  visibilityType: BadgeVisibilityType;
  achievementParams?: BadgeAchievementParams;
}

export interface UserAvailableBadge extends TenantBadgeResponse {
  viewedStatus: BadgeViewedStatus | null;
  lockStatus: BadgeLockStatus;
}

export interface GroupedUserAvailableBadges {
  category: BadgeCategory;
  badges: UserAvailableBadge[];
}

export interface MarkBadgeViewedResponse {
  badgeId: string;
  viewedStatus: BadgeViewedStatus;
}

export type SaveBadgeUsersRequest = {
  userId: number;
  badgeId: string;
}[];
