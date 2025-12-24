import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import * as bcrypt from 'bcrypt';
import { User } from '../../user/entity/user.entity';
import { UserStatus } from '../../user/constants/user-status.constants';
import { Group } from '../../authorization/entity/group.entity';
import { UserGroup } from '../../authorization/entity/user-group.entity';
import { UserRole } from '../../common/constants/user.constants';

config();

const dataSourceOptions = {
  type: 'postgres' as const,
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT!, 10) || 5432,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: [User, Group, UserGroup],
  synchronize: false,
  ssl: false,
};

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
  const dataSource = new DataSource(dataSourceOptions);

  try {
    await dataSource.initialize();
    console.log('Database connection established');

    const userRepository = dataSource.getRepository(User);
    const existingUser = await userRepository.findOne({
      where: { email: adminUser.email },
    });

    if (existingUser) {
      console.log(`User ${adminUser.email} already exists, skipping...`);
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
    console.log(`Created user: ${adminUser.email}`);

    // Assign SUPER_ADMIN role to the user
    const groupRepository = dataSource.getRepository(Group);
    const superAdminGroup = await groupRepository.findOne({
      where: { name: UserRole.SUPER_ADMIN },
    });

    if (!superAdminGroup) {
      console.error(
        'SUPER_ADMIN group not found. Please ensure groups are seeded first.',
      );
      return;
    }

    const userGroupRepository = dataSource.getRepository(UserGroup);
    const userGroup = userGroupRepository.create({
      userId: userResponse.id,
      groupId: superAdminGroup.id,
    });

    await userGroupRepository.save(userGroup);
    console.log(`Assigned SUPER_ADMIN role to user: ${adminUser.email}`);
  } catch (error) {
    console.error('Error seeding users:', error);
    process.exit(1);
  } finally {
    await dataSource.destroy();
  }
}

seedAdminUser();
