import { BadgeViewedStatus } from './badge.constants';

export interface UserBadgeWithDetails {
  id: string;
  badgeId: string;
  userId: number;
  viewedStatus: BadgeViewedStatus;
  createdAt: Date;
  code: string;
  name: string;
  description?: string;
  imageUrl?: string;
}

export interface UserBadgeResponse {
  data: UserBadgeWithDetails[];
}
