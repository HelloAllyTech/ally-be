import axios, { AxiosInstance } from 'axios';
import { config } from 'dotenv';
import { logStep } from './seed-utils';
import { UserRole } from '../../common/constants/user.constants';

config();

const API_BASE_URL = 'http://localhost:8001';

// Admin credentials for authentication
const adminCredentials = {
  username: 'admin@example.com',
  password: 'Password123!',
};

// Tenant to create/use
const tenantData = {
  name: 'Ally Test Tenant',
  code: 'ally',
  description: 'Default tenant for seeding',
};

const dynamicUsers = Object.values(UserRole)
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
      password: 'Password123!',
    };
  });

// Users to create (tenantId will be set dynamically)
const usersToCreate = [
  ...dynamicUsers,
  {
    email: 'user-cla@example.com',
    name: 'Test User CLA',
    roles: [UserRole.COUNSELOR, UserRole.LEARNER, UserRole.ADMIN],
    password: 'Password123!',
  },
];

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
  userData: (typeof usersToCreate)[0] & { tenantId: string },
): Promise<void> {
  try {
    const response = await client.post('/api/v1/users', userData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    logStep(`Created user: ${userData.email} (ID: ${response.data.id})`);
  } catch (error: any) {
    if (error.response?.status === 400) {
      logStep(
        `User ${userData.email} already exists or validation failed: ${error.response?.data?.message}`,
      );
    } else {
      console.error(
        `Failed to create user ${userData.email}:`,
        error.response?.data?.message || error.message,
      );
    }
  }
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
    // Login to get access token
    const { accessToken } = await login(client);

    // Get or create tenant
    const tenantId = await getOrCreateTenant(client, accessToken);

    // Create users with the tenant ID
    for (const user of usersToCreate) {
      await createUser(client, accessToken, { ...user, tenantId });
    }

    logStep('Users seeding completed successfully!');
  } catch (error: any) {
    console.error('Error seeding users:', error.message);
    process.exit(1);
  }
}

seedUsers();
