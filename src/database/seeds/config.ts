import { config as loadEnv } from 'dotenv';

loadEnv();

export const TENANT_CODE = process.env.SEED_TENANT_CODE || 'ally';
export const TENANT_NAME = process.env.SEED_TENANT_NAME || 'Ally';
export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
export const DEFAULT_PASSWORD =
  process.env.SEED_DEFAULT_PASSWORD || 'Password123!';
export const DEFAULT_OTP = process.env.SEED_DEFAULT_OTP || '1234';

export const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: process.env.NODE_ENV === 'production',
};

if (!DB.database) {
  throw new Error('DB_DATABASE is not defined. Did you load your .env file?');
}
