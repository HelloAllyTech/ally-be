import { CreateBadgeDto } from '../dto/badge.dto';

export enum BadgeStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
}

export enum BadgeVisibilityType {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export enum BadgeCategory {
  SIMULATION_MINUTES = 'SIMULATION_MINUTES',
  ACTIVE_DAY_STREAK = 'ACTIVE_DAY_STREAK',
  COMMENTS_REACTIONS_GIVEN = 'COMMENTS_REACTIONS_GIVEN',
  COMMENTS_REACTIONS_RECEIVED = 'COMMENTS_REACTIONS_RECEIVED',
}

export enum BadgeViewedStatus {
  VIEWED = 'VIEWED',
  UNVIEWED = 'UNVIEWED',
}

export enum BadgeLockStatus {
  LOCKED = 'LOCKED',
  UNLOCKED = 'UNLOCKED',
}

export const BADGE_MANDATORY_FIELDS: (keyof CreateBadgeDto)[] = [
  'name',
  'description',
  'imageUrl',
  'category',
  'achievementParams',
  'groupIds',
];
