import { DataSource, In } from 'typeorm';
import { Group } from '../../../authorization/entity/group.entity';
import { UserGroup } from '../../../authorization/entity/user-group.entity';
import { AdminFeatureToggle } from '../../../authorization/entity/admin-feature-toggle.entity';
import {
  FEATURE_TOGGLES,
  FeatureToggleKey,
  FeatureToggleLegacyGrants,
} from '../../../authorization/constants/admin-feature-toggle.constants';
import { UserRole } from '../../../common/constants/user.constants';
import { getRepo, log, upsert } from '../helpers';

// The three retired tiers CreatePlatformAdminRole1895000000001 collapsed into
// PLATFORM_ADMIN. Deliberately excludes PLATFORM_ADMIN itself, so this
// seeder's own output is never mistaken for an input on re-run.
const LEGACY_ADMIN_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.SUPER_DUPER_ADMIN,
  UserRole.MULTI_TENANT_ADMIN,
];

function legacyRoleGrants(
  role: UserRole,
  grants: FeatureToggleLegacyGrants,
): boolean {
  if (role === UserRole.SUPER_ADMIN) return grants.superAdmin;
  if (role === UserRole.SUPER_DUPER_ADMIN) return grants.superDuperAdmin;
  if (role === UserRole.MULTI_TENANT_ADMIN) return grants.multiTenantAdmin;
  return false;
}

/**
 * Grants PLATFORM_ADMIN membership + the admin_feature_toggles rows each
 * legacy-tier user is entitled to, deriving both from LIVE user_groups rows
 * rather than a fixture list — this is CreatePlatformAdminRole1895000000001's
 * steps 3-5 re-run against whoever currently holds a legacy admin group,
 * fixture user or not. On a fresh DB, that migration ran before any seed user
 * existed, so it only ever touched the bootstrap admin
 * (BootstrapLocalAdminOnEmptyDatabase) — without this, every seeded admin
 * (admin@example.com, etc.) is locked out of ~25 admin-dashboard surfaces by
 * FeatureToggleGuard, which fails closed on a missing toggle row.
 *
 * Must run after seedUsers (needs their user_groups rows to exist).
 */
export async function seedAdminAccess(ds: DataSource): Promise<void> {
  const groupRepo = getRepo(ds, Group);
  const userGroupRepo = getRepo(ds, UserGroup);
  const toggleRepo = getRepo(ds, AdminFeatureToggle);

  const groups = await groupRepo.find();
  const groupIdByName = new Map(groups.map((g) => [g.name, g.id]));
  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));

  const platformAdminGroupId = groupIdByName.get(UserRole.PLATFORM_ADMIN);
  if (!platformAdminGroupId) {
    log('group "PLATFORM_ADMIN" missing — run migrations first');
    return;
  }

  const legacyGroupIds = LEGACY_ADMIN_ROLES.map((role) =>
    groupIdByName.get(role),
  ).filter((id): id is number => id !== undefined);
  if (legacyGroupIds.length === 0) {
    log('no legacy admin-tier groups found — run migrations first');
    return;
  }

  const legacyMemberships = await userGroupRepo.find({
    where: { groupId: In(legacyGroupIds) },
  });

  // Collapse to userId -> set of legacy roles held, so a user holding two
  // tiers gets the union of both tiers' toggles (matches the migration).
  const legacyRolesByUserId = new Map<number, Set<UserRole>>();
  for (const membership of legacyMemberships) {
    const roleName = groupNameById.get(membership.groupId) as
      | UserRole
      | undefined;
    if (!roleName) continue;
    const bucket = legacyRolesByUserId.get(membership.userId) ?? new Set();
    bucket.add(roleName);
    legacyRolesByUserId.set(membership.userId, bucket);
  }

  const adminUserIds = [...legacyRolesByUserId.keys()];
  if (adminUserIds.length === 0) {
    log('no legacy admin-tier users found — nothing to grant');
    return;
  }

  let membershipsCreated = 0;
  let togglesCreated = 0;

  for (const [userId, roles] of legacyRolesByUserId) {
    const beforeMembership = await userGroupRepo.findOne({
      where: { userId, groupId: platformAdminGroupId },
    });
    await upsert(
      userGroupRepo,
      { userId, groupId: platformAdminGroupId },
      { userId, groupId: platformAdminGroupId },
    );
    if (!beforeMembership) membershipsCreated++;

    for (const definition of FEATURE_TOGGLES) {
      const enabled = [...roles].some((role) =>
        legacyRoleGrants(role, definition.legacyGrants),
      );
      // A missing row already means "disabled" (fails closed) — never write
      // enabled: false, so the seeder reproduces the migration's exact
      // end-state rather than a superset of toggle rows.
      if (!enabled) continue;

      const beforeToggle = await toggleRepo.findOne({
        where: { userId, featureKey: definition.key },
      });
      await upsert(
        toggleRepo,
        { userId, featureKey: definition.key },
        { enabled: true },
      );
      if (!beforeToggle) togglesCreated++;
    }
  }

  // Bootstrap invariant, mirroring the migration's own safety net: if this
  // ever produces zero enabled ADMIN_USER_MANAGEMENT holders, no seeded admin
  // could ever grant a toggle to anyone — fail loudly instead of shipping a
  // dev DB nobody can administer.
  const adminUserManagementHolders = await toggleRepo.count({
    where: {
      featureKey: FeatureToggleKey.ADMIN_USER_MANAGEMENT,
      enabled: true,
    },
  });
  if (adminUserManagementHolders === 0) {
    throw new Error(
      `seedAdminAccess produced zero enabled '${FeatureToggleKey.ADMIN_USER_MANAGEMENT}' holders — ` +
        'no seeded admin could ever grant a toggle to anyone. Ensure at least one ' +
        'fixture user in src/database/seeds/fixtures.ts holds SUPER_DUPER_ADMIN.',
    );
  }

  log(
    `admin access: ${adminUserIds.length} legacy-tier user(s), ` +
      `${membershipsCreated} PLATFORM_ADMIN membership(s) created, ` +
      `${togglesCreated} feature toggle(s) created`,
  );
  log(
    'note: flush redis (user:roles:*, user:groups:*, admin:feature-toggles:*) ' +
      'or re-login for admin access to take effect immediately.',
  );
}
