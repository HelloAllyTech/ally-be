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

/**
 * Every group name that means "this is an Ally staff account", live and retired.
 *
 * The live one is PLATFORM_ADMIN. The other three are the tiers
 * `CreatePlatformAdminRole1895000000001` collapsed into it, whose `groups` rows
 * were deliberately left in place for rollback safety — so an account still
 * carrying one is still staff, and any check that asks "is this person one of
 * us?" has to name all four.
 *
 * Use this, NOT `SUPER_ADMIN_ROLES`, for that question. `SUPER_ADMIN_ROLES`
 * lists only the two retired super-admin tiers, so an account promoted through
 * the Ally admins screen since the collapse — which grants PLATFORM_ADMIN and
 * nothing else — does not match it. A check written against that list reads
 * every present-day admin as an ordinary app user, silently and plausibly.
 * `TenantCohortMemberRepository` spells the same four names out in raw SQL for
 * the same reason.
 */
export const PLATFORM_TIER_ROLES: UserRole[] = [
  UserRole.PLATFORM_ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.SUPER_DUPER_ADMIN,
  UserRole.MULTI_TENANT_ADMIN,
];

/**
 * Platform-tier groups that the generic role picker must never grant or revoke.
 *
 * The same four names as `PLATFORM_TIER_ROLES`, aliased rather than repeated so
 * a fifth tier is added in one place — but kept as its own export because the
 * rule it encodes is a different one, spelled out below.
 *
 * PLATFORM_ADMIN is owned by the dedicated Ally admins screen
 * (POST/DELETE /v1/platform-admins), which also writes the per-user feature
 * toggles that decide what an admin can actually reach. Granting it through
 * `POST /v1/authorization/change-roles` instead produces an admin with the full
 * platform permission set and *no* toggles, because the toggle backfill only
 * ever ran inside CreatePlatformAdminRole1895000000001.
 *
 * The other three are the retired tiers that same migration collapsed. Their
 * `groups` and `group_permissions` rows were deliberately left in place for
 * rollback safety, so assigning one still grants real, fully-permissioned
 * access — to an account the Ally admins screen cannot see, since that screen
 * lists PLATFORM_ADMIN holders.
 *
 * changeUserRoles therefore treats the two directions differently. Asking to
 * grant one is an explicit request it cannot honour correctly, so it 400s and
 * names the right endpoint. Not mentioning one the account already holds is
 * not a request to revoke it — the picker can't see these groups — so they are
 * left alone; otherwise an app-role change on a platform admin's account would
 * strip their access as collateral.
 *
 * Only `changeUserRoles` is constrained. `assignRole` is the single-role path
 * that platform-admin.service itself calls to grant PLATFORM_ADMIN, so guarding
 * it would break the very screen this constant protects.
 */
export const PLATFORM_MANAGED_ROLES: UserRole[] = PLATFORM_TIER_ROLES;

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
  /**
   * Org-level switch letting a tenant's own ADMINs reach the Character Library
   * (list + interview agent + create) for characters scoped to their tenant.
   * OFF when the row is absent. Platform admins do NOT go through this — they
   * are gated by the per-user `character_library` feature toggle instead.
   */
  CHARACTER_LIBRARY_ENABLED = 'CHARACTER_LIBRARY_ENABLED',
  /**
   * Org-level switch for the learner Progress dashboard and its nav indicator.
   * OFF when the row is absent, which is the launch state for every tenant — the
   * feature is rolled out org by org rather than all at once.
   */
  PROGRESS_DASHBOARD_ENABLED = 'PROGRESS_DASHBOARD_ENABLED',
}

export enum PreferenceRelatedEntity {
  ORGANIZATION = 'ORGANIZATION',
  COUNSELOR = 'COUNSELOR',
}

export const ANONYMOUS_CLIENT_ID = -1;

export const PLACEHOLDER_CHAT_ID = -99;
