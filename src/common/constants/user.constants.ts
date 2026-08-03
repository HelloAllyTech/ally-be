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
  INTERNAL = 'INTERNAL',
}

/**
 * Platform-level super-admin roles. SUPER_DUPER_ADMIN and INTERNAL are both
 * peers of SUPER_ADMIN: they have identical access today and may gain extra
 * capabilities later. Any name-based SUPER_ADMIN check (role guards,
 * tenant-skip logic, user-list exclusion, etc.) should compare against this
 * list so all three roles behave identically — permission-gated code already
 * works for all of them because each is granted the same permissions as
 * SUPER_ADMIN.
 *
 * INTERNAL exists so Ally staff can be given the super-admin console without
 * being listed (or manageable) as a super admin. It is a *surface* distinction,
 * not a privilege one: the API access it confers is identical to SUPER_ADMIN,
 * and the only intended difference is where the holder signs in — the console
 * path-mounted on the consumer app rather than the standalone admin dashboard.
 */
export const SUPER_ADMIN_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.SUPER_DUPER_ADMIN,
  UserRole.INTERNAL,
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
