import {
  BadgeCategory,
  BadgeStatus,
  BadgeViewedStatus,
  BadgeVisibilityType,
} from '../../badge/constants/badge.constants';

export interface BadgeSeedRecord {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  status: BadgeStatus;
  visibilityType: BadgeVisibilityType;
  category: BadgeCategory;
  achievementParams?: Record<string, any> | null;
  translations?: Record<string, any> | null;
  groupNames: string[];
  tenantCodes: string[];
  userAssignments: Array<{
    email: string;
    viewedStatus: BadgeViewedStatus;
  }>;
}

export interface BadgeSeedData {
  source: {
    generatedAt: string;
    database: string;
    badgeCount: number;
  };
  badges: BadgeSeedRecord[];
}
