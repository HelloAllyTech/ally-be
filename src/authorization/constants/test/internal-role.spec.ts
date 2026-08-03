import {
  SUPER_ADMIN_PERMISSIONS,
  SUPER_DUPER_ADMIN_PERMISSIONS,
  INTERNAL_PERMISSIONS,
  PERMISSIONS,
} from '../permissions.constants';
import {
  SUPER_ADMIN_ROLES,
  SUPER_DUPER_ADMIN_ROLES,
  UserRole,
} from '../../../common/constants/user.constants';

/**
 * INTERNAL is defined as a strict clone of SUPER_ADMIN. These tests pin that
 * contract down: it is easy to add a permission to SUPER_ADMIN and forget
 * INTERNAL, and the drift would only show up as a 403 in the console mounted
 * at /admin on the consumer app.
 */
describe('INTERNAL role', () => {
  it('grants exactly the SUPER_ADMIN permission set', () => {
    expect([...INTERNAL_PERMISSIONS].sort()).toEqual(
      [...SUPER_ADMIN_PERMISSIONS].sort(),
    );
  });

  it('does not inherit the SUPER_DUPER_ADMIN-only capabilities', () => {
    const elevatedOnly = SUPER_DUPER_ADMIN_PERMISSIONS.filter(
      (permission) => !SUPER_ADMIN_PERMISSIONS.includes(permission),
    );

    // Guards against the list silently becoming empty and making the
    // assertion below vacuous.
    expect(elevatedOnly).toEqual(
      expect.arrayContaining([
        PERMISSIONS.VIEW_SUPER_DUPER_ADMINS,
        PERMISSIONS.EDIT_SUPER_DUPER_ADMINS,
      ]),
    );

    for (const permission of elevatedOnly) {
      expect(INTERNAL_PERMISSIONS).not.toContain(permission);
    }
  });

  it('passes name-based super-admin gates', () => {
    // @AuthRoles(...SUPER_ADMIN_ROLES) guards analytics, learn admin routes,
    // session events and roleplay session logs — INTERNAL must clear them.
    expect(SUPER_ADMIN_ROLES).toContain(UserRole.INTERNAL);
  });

  it('is not part of the elevated super-duper-admin tier', () => {
    expect(SUPER_DUPER_ADMIN_ROLES).not.toContain(UserRole.INTERNAL);
  });

  it('holds system access, so it is not pinned to a single tenant', () => {
    // SYSTEM_ACCESS is what lets OwnTenantScopeGuard wave a caller through and
    // what lets the JWT strategy accept a tenant-less token.
    expect(INTERNAL_PERMISSIONS).toContain(PERMISSIONS.SYSTEM_ACCESS);
  });
});
