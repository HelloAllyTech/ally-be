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
  /**
   * The single platform-tier role, replacing SUPER_ADMIN / SUPER_DUPER_ADMIN /
   * MULTI_TENANT_ADMIN (kept, unreferenced by new code, for rollback safety —
   * see CreatePlatformAdminRole1895000000001). Fine-grained access is
   * per-user feature toggles (admin_feature_toggles), not sub-tiers of this
   * role. Named PLATFORM_ADMIN rather than ADMIN because ADMIN already means
   * something different: a tenant-scoped org admin.
   */
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
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

/**
 * The elevated super-admin tier. SUPER_DUPER_ADMIN sits above SUPER_ADMIN: gate
 * the most privileged surfaces on this list so a plain SUPER_ADMIN is excluded.
 * Mirrors ally-web's SUPER_DUPER_ADMIN_ROLES; kept as an array to leave room for
 * future peer roles.
 */
export const SUPER_DUPER_ADMIN_ROLES: UserRole[] = [UserRole.SUPER_DUPER_ADMIN];

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
