import { DataSource } from 'typeorm';
import { User } from '../../../user/entity/user.entity';
import { Group } from '../../../authorization/entity/group.entity';
import { UserGroup } from '../../../authorization/entity/user-group.entity';
import { AdminTenant } from '../../../user/entity/admin-tenant.entity';
import { Tenant } from '../../../tenant/entity/tenant.entity';
import { UserRole } from '../../../common/constants/user.constants';
import { getRepo, hashPassword, log, upsert } from '../helpers';
import { users, defaults } from '../fixtures';
import { DEFAULT_PASSWORD } from '../config';

export async function seedUsers(ds: DataSource, tenant: Tenant): Promise<void> {
  const userRepo = getRepo(ds, User);
  const groupRepo = getRepo(ds, Group);
  const userGroupRepo = getRepo(ds, UserGroup);
  const adminTenantRepo = getRepo(ds, AdminTenant);

  const groups = await groupRepo.find();
  const groupIdByName = new Map(groups.map((g) => [g.name, g.id]));

  const hashedPassword = await hashPassword(DEFAULT_PASSWORD);

  for (const fixture of users) {
    const user = await upsert(
      userRepo,
      { email: fixture.email },
      {
        name: fixture.name,
        username: fixture.email,
        password: hashedPassword,
        status: defaults.userStatus,
        tenantId: tenant.id,
        termsAndAgreementApproved: true,
        termsAndAgreementApprovedAt: new Date(),
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
      const existing = await adminTenantRepo.findOne({
        where: { userId: user.id, tenantId: tenant.id },
        withDeleted: true,
      });
      if (!existing) {
        await adminTenantRepo.save({ userId: user.id, tenantId: tenant.id });
      } else if (existing.deletedAt) {
        await adminTenantRepo.update(
          { id: existing.id },
          { deletedAt: null as unknown as Date },
        );
      }
    }

    log(`user ${user.email} (id=${user.id}, roles=${fixture.roles.join(',')})`);
  }
}
