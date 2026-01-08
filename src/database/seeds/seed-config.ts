import { config } from 'dotenv';

config();

/**
 * Seed Configuration
 *
 * Central configuration for all seed operations.
 * All values can be overridden via environment variables.
 */

export const SEED_CONFIG = {
  // API Configuration
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:8001',
    timeout: parseInt(process.env.API_TIMEOUT || '30000', 10),
  },

  // Admin credentials (change in production)
  admin: {
    email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.SEED_ADMIN_PASSWORD || 'Password123!',
  },

  // Tenant configuration
  tenant: {
    name: process.env.SEED_TENANT_NAME || 'Ally Test Tenant',
    code: process.env.SEED_TENANT_CODE || 'ally',
    description:
      process.env.SEED_TENANT_DESCRIPTION || 'Default tenant for seeding',
  },

  // Test users to create
  users: [
    {
      email: process.env.SEED_COUNSELOR_EMAIL || 'counselor@example.com',
      name: 'Test Counselor',
      password: process.env.SEED_COUNSELOR_PASSWORD || 'Password123!',
      roles: ['COUNSELOR'],
    },
    {
      email: process.env.SEED_LEARNER_EMAIL || 'learner@example.com',
      name: 'Test Learner',
      password: process.env.SEED_LEARNER_PASSWORD || 'Password123!',
      roles: ['LEARNER'],
    },
    {
      email: process.env.SEED_ORG_ADMIN_EMAIL || 'org-admin@example.com',
      name: 'Test Org Admin',
      password: process.env.SEED_ORG_ADMIN_PASSWORD || 'Password123!',
      roles: ['ADMIN'],
    },
    {
      email: process.env.SEED_MULTI_ROLE_EMAIL || 'user-cla@example.com',
      name: 'Test Multi-Role User',
      password: process.env.SEED_MULTI_ROLE_PASSWORD || 'Password123!',
      roles: ['COUNSELOR', 'LEARNER', 'ADMIN'],
    },
  ],

  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'ally',
  },

  // Logging
  logging: {
    verbose: process.env.SEED_VERBOSE === 'true',
    outputFormat: process.env.SEED_LOG_FORMAT || 'console', // 'console' or 'json'
  },

  // Execution options
  execution: {
    stopOnFirstError: process.env.SEED_STOP_ON_ERROR === 'true',
    retryFailed: process.env.SEED_RETRY_FAILED !== 'false',
    maxRetries: parseInt(process.env.SEED_MAX_RETRIES || '3', 10),
  },
};

export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!SEED_CONFIG.api.baseUrl) {
    errors.push('API_BASE_URL is not configured');
  }

  if (!SEED_CONFIG.admin.email || !SEED_CONFIG.admin.password) {
    errors.push('Admin credentials are not configured');
  }

  if (!SEED_CONFIG.database.host) {
    errors.push('Database host is not configured');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function printConfig(): void {
  console.log('\n📋 Seed Configuration:');
  console.log(`   API Base URL: ${SEED_CONFIG.api.baseUrl}`);
  console.log(`   API Timeout: ${SEED_CONFIG.api.timeout}ms`);
  console.log(
    `   Tenant: ${SEED_CONFIG.tenant.code} (${SEED_CONFIG.tenant.name})`,
  );
  console.log(`   Test Users: ${SEED_CONFIG.users.length}`);
  console.log(
    `   Database: ${SEED_CONFIG.database.host}:${SEED_CONFIG.database.port}/${SEED_CONFIG.database.database}`,
  );
  console.log(`   Verbose Logging: ${SEED_CONFIG.logging.verbose}`);
  console.log('');
}
