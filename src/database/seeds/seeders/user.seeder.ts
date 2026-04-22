import { DataSource } from 'typeorm';
import { User } from '../../../user/entity/user.entity';
import { Group } from '../../../authorization/entity/group.entity';
import { UserGroup } from '../../../authorization/entity/user-group.entity';
import { getRepo, hashPassword, log, upsert } from '../helpers';
import { users, defaults } from '../fixtures';
import { DEFAULT_PASSWORD, TENANT_CODE } from '../config';

export async function seedUsers(ds: DataSource): Promise<void> {
  const userRepo = getRepo(ds, User);
  const groupRepo = getRepo(ds, Group);
  const userGroupRepo = getRepo(ds, UserGroup);

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
        tenantId: TENANT_CODE,
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

    log(`user ${user.email} (id=${user.id}, roles=${fixture.roles.join(',')})`);
  }
}
