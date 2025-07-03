export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  BLOCKED = 'BLOCKED',
}

export enum UserRole {
  CLIENT = 'CLIENT',
  COUNSELOR = 'COUNSELOR',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
}

export enum PreferenceName {
  SUMMARY_HIDDEN_FIELDS = 'SUMMARY_HIDDEN_FIELDS',
  NUDGE_STATUS = 'NUDGE_STATUS',
}

export enum PreferenceRelatedEntity {
  ORGANIZATION = 'ORGANIZATION',
  COUNSELOR = 'COUNSELOR',
}

export const ANONYMOUS_CLIENT_ID = -1;
