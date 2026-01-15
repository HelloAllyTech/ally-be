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
  COMMENTS_REACTIONS_GIVEN = 'COMMENTS_REACTION_GIVEN',
  COMMENTS_REACTIONS_RECEIVED = 'COMMENTS_REACTIONS_RECEIVED',
}

export enum BadgeViewedStatus {
  VIEWED = 'VIEWED',
  UNVIEWED = 'UNVIEWED',
}

export interface BadgeAchievementParams {
  count?: number;
}
