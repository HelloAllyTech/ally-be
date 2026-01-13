import { config } from 'dotenv';
import {
  DataSource,
  DataSourceOptions,
  EntitySchema,
  LoggerOptions,
} from 'typeorm';

config();

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || '5432';
const DB_USERNAME = process.env.DB_USERNAME;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_DATABASE = process.env.DB_DATABASE;
const NODE_ENV = process.env.NODE_ENV;

if (!DB_DATABASE) {
  throw new Error('DB_DATABASE is not defined. Did you load your .env file?');
}

const shouldUseSSL = NODE_ENV === 'production';

export const DEFAULT_TENANT_CODE_ENV =
  process.env.DEFAULT_TENANT_CODE || 'ally';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSeedDataSource(
  entities: (any | string | EntitySchema)[],
  logging: LoggerOptions | boolean = false,
) {
  const options: DataSourceOptions = {
    type: 'postgres',
    host: DB_HOST,
    port: parseInt(DB_PORT, 10),
    username: DB_USERNAME,
    password: DB_PASSWORD,
    database: DB_DATABASE,
    entities,
    synchronize: false,
    ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
    logging,
  };

  return new DataSource(options);
}

export function logStep(message: string) {
  console.log(`[seed] ${message}`);
}
