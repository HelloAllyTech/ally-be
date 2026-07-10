export enum UserRole {
  CLIENT = 'CLIENT',
  COUNSELOR = 'COUNSELOR',
  SUPER_ADMIN = 'SUPER_ADMIN',
  SUPER_DUPER_ADMIN = 'SUPER_DUPER_ADMIN',
  ADMIN = 'ADMIN',
  LEARNER = 'LEARNER',
  SIMULATION_REVIEWER = 'SIMULATION_REVIEWER',
  SCRIBE_REVIEWER = 'SCRIBE_REVIEWER',
  MULTI_TENANT_ADMIN = 'MULTI_TENANT_ADMIN',
}

/**
 * Platform-level super-admin roles. SUPER_DUPER_ADMIN is a peer of SUPER_ADMIN:
 * it has identical access today and may gain extra capabilities later. Any
 * name-based SUPER_ADMIN check (role guards, tenant-skip logic, user-list
 * exclusion, etc.) should compare against this list so both roles behave
 * identically — permission-gated code already works for both because
 * SUPER_DUPER_ADMIN is granted the same permissions as SUPER_ADMIN.
 */
export const SUPER_ADMIN_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.SUPER_DUPER_ADMIN,
];

export enum AppType {
  APP = 'APP',
  ADMIN = 'ADMIN',
}

export enum PreferenceName {
  SUMMARY_HIDDEN_FIELDS = 'SUMMARY_HIDDEN_FIELDS',
  SUMMARY_HIDDEN_SECTIONS = 'SUMMARY_HIDDEN_SECTIONS',
  NUDGE_STATUS = 'NUDGE_STATUS',
  HIDDEN_CHAT_TYPES = 'HIDDEN_CHAT_TYPES',
  ENABLED_CUSTOM_FIELD_TYPES = 'ENABLED_CUSTOM_FIELD_TYPES',
  CUSTOM_FIELDS_ENABLED = 'CUSTOM_FIELDS_ENABLED',
  SCRIBE_NOTE_CREATION_ENABLED = 'SCRIBE_NOTE_CREATION_ENABLED',
  SCRIBE_VOICE_NOTE_ENABLED = 'SCRIBE_VOICE_NOTE_ENABLED',
}

export enum PreferenceRelatedEntity {
  ORGANIZATION = 'ORGANIZATION',
  COUNSELOR = 'COUNSELOR',
}

export const ANONYMOUS_CLIENT_ID = -1;

export const PLACEHOLDER_CHAT_ID = -99;
