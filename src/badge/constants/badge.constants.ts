export enum BadgeStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
}

export enum BadgeVisibilityType {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export enum BadgeAchievementType {
  SIMULATION_MINUTES_REACHED = 'SIMULATION_MINUTES_REACHED',
  CONSECUTIVE_ACTIVE_DAYS_REACHED = 'CONSECUTIVE_ACTIVE_DAYS_REACHED',
  COMMENT_OR_REACTION_COUNT_REACHED = 'COMMENT_OR_REACTION_COUNT_REACHED',
}

export enum BadgeViewedStatus {
  VIEWED = 'VIEWED',
  UNVIEWED = 'UNVIEWED',
}

export interface BadgeAchievementParams {
  days?: number;
  minutes?: number;
  count?: number;
}

export interface BadgeAchievementCriteria {
  type: BadgeAchievementType;
  params: BadgeAchievementParams;
}
