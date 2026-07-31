import { DataSource } from 'typeorm';
import { User } from '../../../user/entity/user.entity';
import { UserStatus } from '../../../user/constants/user-status.constants';
import { UserPreferences } from '../../../user/entity/user-preferences.entity';
import { Group } from '../../../authorization/entity/group.entity';
import { UserGroup } from '../../../authorization/entity/user-group.entity';
import { AdminTenant } from '../../../user/entity/admin-tenant.entity';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { UserRole } from '../../../common/constants/user.constants';
import { getRepo, hashPassword, log, upsert } from '../helpers';
import { users, defaults } from '../fixtures';
import { DEFAULT_PASSWORD, ADMIN_EMAIL } from '../config';

async function ensureAdminTenant(
  ds: DataSource,
  userId: number,
  tenantId: string,
): Promise<void> {
  const repo = getRepo(ds, AdminTenant);
  const existing = await repo.findOne({
    where: { userId, tenantId },
    withDeleted: true,
  });
  if (!existing) {
    await repo.save({ userId, tenantId });
  } else if (existing.deletedAt) {
    await repo.update(
      { id: existing.id },
      { deletedAt: null as unknown as Date },
    );
  }
}

export async function seedUsers(
  ds: DataSource,
  tenants: Tenant[],
): Promise<void> {
  const userRepo = getRepo(ds, User);
  const preferencesRepo = getRepo(ds, UserPreferences);
  const groupRepo = getRepo(ds, Group);
  const userGroupRepo = getRepo(ds, UserGroup);

  const tenantIdByCode = new Map(tenants.map((t) => [t.code, t.id]));
  const groups = await groupRepo.find();
  const groupIdByName = new Map(groups.map((g) => [g.name, g.id]));

  const hashedPassword = await hashPassword(DEFAULT_PASSWORD);
  const now = new Date();

  for (const fixture of users) {
    const tenantId = tenantIdByCode.get(fixture.tenantCode);
    if (!tenantId) {
      log(`tenant "${fixture.tenantCode}" missing — skipping ${fixture.email}`);
      continue;
    }

    const suspended = fixture.suspended ?? false;
    // The root admin (processed first, above) is the one who "suspended"
    // any individually-suspended seed account.
    const suspendedBy = suspended
      ? (await userRepo.findOne({ where: { email: ADMIN_EMAIL } }))?.id
      : undefined;

    const user = await upsert(
      userRepo,
      { email: fixture.email },
      {
        name: fixture.name,
        username: fixture.email,
        password: hashedPassword,
        status: suspended ? UserStatus.SUSPENDED : defaults.userStatus,
        tenantId,
        profileCompleted: fixture.profileCompleted ?? true,
        termsAndAgreementApproved: fixture.termsAndAgreementApproved ?? true,
        termsAndAgreementApprovedAt:
          fixture.termsAndAgreementApproved === false ? undefined : now,
        suspendedBy,
        suspendedAt: suspended ? now : undefined,
      },
    );

    await upsert(
      preferencesRepo,
      { userId: user.id },
      {
        tenantId,
        data: {
          onboardingCompleted: fixture.profileCompleted ?? true,
          preferredLanguage: 'en-IN',
        },
      },
    );

    for (const role of fixture.roles) {
      const groupId = groupIdByName.get(role);
      if (!groupId) {
        log(`group "${role}" missing — run migrations first`);
        continue;
      }
      await upsert(
        userGroupRepo,
        { userId: user.id, groupId },
        { userId: user.id, groupId },
      );
    }

    if (fixture.roles.includes(UserRole.MULTI_TENANT_ADMIN)) {
      await ensureAdminTenant(ds, user.id, tenantId);
      for (const extraCode of fixture.additionalAdminTenantCodes ?? []) {
        const extraTenantId = tenantIdByCode.get(extraCode);
        if (!extraTenantId) continue;
        await ensureAdminTenant(ds, user.id, extraTenantId);
      }
    }

    log(
      `user ${user.email} (id=${user.id}, tenant=${fixture.tenantCode}, roles=${fixture.roles.join(',')})`,
    );
  }
}
