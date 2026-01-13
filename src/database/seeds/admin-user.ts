import { createSeedDataSource, logStep } from './seed-utils';
import * as bcrypt from 'bcrypt';
import { User } from '../../user/entity/user.entity';
import { UserStatus } from '../../user/constants/user-status.constants';
import { Group } from '../../authorization/entity/group.entity';
import { UserGroup } from '../../authorization/entity/user-group.entity';
import { UserRole } from '../../common/constants/user.constants';

const adminUser = {
  email: 'admin@example.com',
  name: 'Admin User',
  username: 'admin@example.com',
  password: 'Password123!',
  status: UserStatus.ACTIVE,
  tenantId: 'ally',
};

async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

async function seedAdminUser() {
  const dataSource = createSeedDataSource([User, Group, UserGroup], false);

  try {
    await dataSource.initialize();
    logStep('Database connection established');

    const userRepository = dataSource.getRepository(User);
    const existingUser = await userRepository.findOne({
      where: { email: adminUser.email },
    });

    if (existingUser) {
      logStep(`User ${adminUser.email} already exists, skipping...`);
      return;
    }

    const user = userRepository.create({
      ...adminUser,
      password: adminUser.password
        ? await hashPassword(adminUser.password)
        : undefined,
      termsAndAgreementApprovedAt: new Date(),
    });

    const userResponse = await userRepository.save(user);
    logStep(`Created user: ${adminUser.email}`);

    // Assign SUPER_ADMIN role to the user
    const groupRepository = dataSource.getRepository(Group);
    const superAdminGroup = await groupRepository.findOne({
      where: { name: UserRole.SUPER_ADMIN },
    });

    if (!superAdminGroup) {
      console.error(
        '[seed] SUPER_ADMIN group not found. Please ensure groups are seeded first.',
      );
      return;
    }

    const userGroupRepository = dataSource.getRepository(UserGroup);
    const userGroup = userGroupRepository.create({
      userId: userResponse.id,
      groupId: superAdminGroup.id,
    });

    await userGroupRepository.save(userGroup);
    logStep(`Assigned SUPER_ADMIN role to user: ${adminUser.email}`);
    logStep('Admin user seeding completed successfully!');
  } catch (error) {
    console.error('[seed] Error seeding users:', error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

seedAdminUser();
