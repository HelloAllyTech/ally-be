import axios, { AxiosInstance } from 'axios';
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { logStep } from './seed-utils';
import { UserRole } from '../../common/constants/user.constants';
import { UserStatus } from '../../user/constants/user-status.constants';
import {
  SeedTenantRecord,
  SeedUserRecord,
  UserTenantSeedData,
} from './user-tenant.seed-data';

config();

const API_BASE_URL = process.env.SEED_API_BASE_URL || 'http://localhost:8001';
const SEED_DATA_FILE = resolve(__dirname, './data/user-tenant.json');
const DEFAULT_USER_PASSWORD =
  process.env.SEED_USER_DEFAULT_PASSWORD || 'Password123!';

// Admin credentials for authentication
const adminCredentials = {
  username: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
  password: process.env.SEED_ADMIN_PASSWORD || 'Password123!',
};

// Fallback tenant when no exported dataset exists yet.
const fallbackTenantData = {
  name: 'Ally Test Tenant',
  code: 'ally',
  description: 'Default tenant for seeding',
};

const fallbackDynamicUsers = Object.values(UserRole)
  .filter((role) => role !== UserRole.SUPER_ADMIN && role !== UserRole.CLIENT)
  .map((role) => {
    const emailPrefix =
      role === UserRole.ADMIN
        ? 'org-admin'
        : role.toLowerCase().replace(/_/g, '-');
    const nameStr = role
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');

    return {
      email: `${emailPrefix}@example.com`,
      name: `Test ${nameStr}`,
      roles: [role],
    };
  });

// Fallback users when no exported dataset exists yet.
const fallbackUsersToCreate = [
  ...fallbackDynamicUsers,
  {
    email: 'user-cla@example.com',
    name: 'Test User CLA',
    roles: [UserRole.COUNSELOR, UserRole.LEARNER, UserRole.ADMIN],
  },
];

type SeedUserInput = SeedUserRecord & { password: string };

function loadSeedData(): UserTenantSeedData {
  if (!existsSync(SEED_DATA_FILE)) {
    logStep(
      `Seed data file not found at ${SEED_DATA_FILE}. Falling back to built-in sample users.`,
    );
    return {
      source: {
        generatedAt: new Date(0).toISOString(),
        database: 'fallback',
        tenantCount: 1,
        userCount: fallbackUsersToCreate.length,
      },
      tenants: [fallbackTenantData],
      users: fallbackUsersToCreate.map((user) => ({
        ...user,
        tenantCode: fallbackTenantData.code,
        adminTenantCodes: [],
        status: UserStatus.ACTIVE,
      })),
    };
  }

  const rawData = readFileSync(SEED_DATA_FILE, 'utf8');
  const parsed = JSON.parse(rawData) as UserTenantSeedData;

  logStep(
    `Loaded user seed dataset from ${SEED_DATA_FILE} (${parsed.users.length} users / ${parsed.tenants.length} tenants)`,
  );

  return parsed;
}

async function login(
  client: AxiosInstance,
): Promise<{ accessToken: string; refreshToken: string }> {
  try {
    const response = await client.post('/api/v1/auth/login', adminCredentials);
    logStep('Login successful');
    return {
      accessToken: response.data.accessToken,
      refreshToken: response.data.refreshToken,
    };
  } catch (error: any) {
    console.error(
      'Login failed:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

async function getOrCreateTenant(
  client: AxiosInstance,
  accessToken: string,
  tenantData: SeedTenantRecord,
): Promise<string> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  // Try to get tenant by code
  try {
    const response = await client.get(
      `/api/v1/tenants/code/${tenantData.code}`,
      { headers },
    );
    if (response.data?.id) {
      logStep(
        `Found existing tenant: ${tenantData.code} (${response.data.id})`,
      );
      return response.data.id;
    }
  } catch (error: any) {
    if (error.response?.status !== 404) {
      logStep(`Tenant lookup returned: ${error.response?.status}`);
    }
  }

  // Create tenant if not found
  try {
    const response = await client.post('/api/v1/tenants', tenantData, {
      headers,
    });
    logStep(`Created tenant: ${tenantData.code} (${response.data.id})`);
    return response.data.id;
  } catch (error: any) {
    if (error.response?.data?.message?.includes('already exists')) {
      // If it already exists, try fetching all tenants
      const listResponse = await client.get('/api/v1/tenants', { headers });
      const tenant = listResponse.data?.data?.find(
        (t: any) => t.code === tenantData.code,
      );
      if (tenant) {
        logStep(`Found tenant in list: ${tenantData.code} (${tenant.id})`);
        return tenant.id;
      }
    }
    console.error(
      'Failed to create/find tenant:',
      error.response?.data?.message || error.message,
    );
    throw error;
  }
}

async function createUser(
  client: AxiosInstance,
  accessToken: string,
  userData: SeedUserInput & { tenantId: string },
): Promise<number | null> {
  try {
    const response = await client.post('/api/v1/users', userData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    logStep(`Created user: ${userData.email} (ID: ${response.data.id})`);
    return response.data.id;
  } catch (error: any) {
    if (error.response?.status === 400) {
      logStep(
        `User ${userData.email} already exists or validation failed: ${error.response?.data?.message}`,
      );
      return null;
    } else {
      console.error(
        `Failed to create user ${userData.email}:`,
        error.response?.data?.message || error.message,
      );
      throw error;
    }
  }
}

async function getUserByEmail(
  client: AxiosInstance,
  accessToken: string,
  email: string,
): Promise<{ id: number; roles: string[]; status: UserStatus } | null> {
  const response = await client.get('/api/v1/users', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      limit: 500,
      search: email,
    },
  });

  const matchedUser = response.data?.data?.find(
    (user: any) => user.email?.toLowerCase() === email.toLowerCase(),
  );

  if (!matchedUser) {
    return null;
  }

  return {
    id: Number(matchedUser.id),
    roles: matchedUser.roles || [],
    status: matchedUser.status,
  };
}

async function ensureUserRoles(
  client: AxiosInstance,
  accessToken: string,
  userId: number,
  existingRoles: string[],
  desiredRoles: string[],
  email: string,
): Promise<void> {
  const missingRoles = desiredRoles.filter(
    (role) => !existingRoles.includes(role),
  );

  for (const role of missingRoles) {
    await client.post(
      '/api/v1/users/assign-role',
      { userId, role },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    logStep(`Assigned missing role ${role} to ${email}`);
  }
}

async function ensureUserStatus(
  client: AxiosInstance,
  accessToken: string,
  userId: number,
  currentStatus: UserStatus,
  desiredStatus: UserStatus | undefined,
  email: string,
): Promise<void> {
  if (!desiredStatus || currentStatus === desiredStatus) {
    return;
  }

  await client.patch(
    `/api/v1/users/${userId}/status`,
    { status: desiredStatus },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  logStep(`Updated status for ${email} to ${desiredStatus}`);
}

async function ensureAdminTenantAssignments(
  client: AxiosInstance,
  accessToken: string,
  userId: number,
  desiredTenantCodes: string[] | undefined,
  tenantIdByCode: Map<string, string>,
  email: string,
): Promise<void> {
  if (!desiredTenantCodes?.length) {
    return;
  }

  const desiredTenantIds = desiredTenantCodes
    .map((code) => tenantIdByCode.get(code))
    .filter((tenantId): tenantId is string => Boolean(tenantId));

  if (!desiredTenantIds.length) {
    return;
  }

  const response = await client.get(`/api/v1/users/${userId}/admin-tenants`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const existingTenantIds = new Set(
    (response.data?.data || []).map((tenant: any) => tenant.id),
  );
  const tenantIdsToAssign = desiredTenantIds.filter(
    (tenantId) => !existingTenantIds.has(tenantId),
  );

  if (!tenantIdsToAssign.length) {
    return;
  }

  await client.post(
    '/api/v1/users/admin-tenants',
    {
      userId,
      tenantIds: tenantIdsToAssign,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  logStep(
    `Assigned ${tenantIdsToAssign.length} admin tenant mappings to ${email}`,
  );
}

async function seedUsers() {
  logStep(`Connecting to API at: ${API_BASE_URL}`);

  const client = axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  try {
    const seedData = loadSeedData();

    // Login to get access token
    const { accessToken } = await login(client);

    const tenantIdByCode = new Map<string, string>();
    for (const tenant of seedData.tenants) {
      const tenantId = await getOrCreateTenant(client, accessToken, tenant);
      tenantIdByCode.set(tenant.code, tenantId);
    }

    for (const user of seedData.users) {
      const tenantId = tenantIdByCode.get(user.tenantCode);

      if (!tenantId) {
        logStep(
          `Skipping user ${user.email}: tenant code "${user.tenantCode}" was not created`,
        );
        continue;
      }

      const createdUserId = await createUser(client, accessToken, {
        ...user,
        tenantId,
        password: DEFAULT_USER_PASSWORD,
      });
      const resolvedUser =
        createdUserId !== null
          ? {
              id: createdUserId,
              roles: [],
              status: UserStatus.ACTIVE,
            }
          : await getUserByEmail(client, accessToken, user.email);

      if (!resolvedUser) {
        logStep(`Unable to resolve user ${user.email} after create/lookup`);
        continue;
      }

      await ensureUserRoles(
        client,
        accessToken,
        resolvedUser.id,
        resolvedUser.roles,
        user.roles,
        user.email,
      );
      await ensureUserStatus(
        client,
        accessToken,
        resolvedUser.id,
        resolvedUser.status,
        user.status,
        user.email,
      );
      await ensureAdminTenantAssignments(
        client,
        accessToken,
        resolvedUser.id,
        user.adminTenantCodes,
        tenantIdByCode,
        user.email,
      );
    }

    logStep('Users seeding completed successfully!');
  } catch (error: any) {
    console.error('Error seeding users:', error.message);
    process.exit(1);
  }
}

seedUsers();
