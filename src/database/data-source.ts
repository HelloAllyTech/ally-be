import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';

config(); // Load .env file

const parsePositiveInt = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT!, 10) || 5432,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: ['dist/common/entities/*.entity.js', 'dist/*/entity/*.entity.js'],
  migrations: ['dist/database/migrations/[0-9]*.js'], // Point to compiled JS files; excludes migration-timestamps.spec.js
  synchronize: false, // Set to false in production
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  logging: false,
  // `pg` defaults to max=10 and no idle/statement timeout. Explicit pool config
  // prevents (a) under-sizing under sustained load and (b) idle connections
  // silently dying server-side without TypeORM knowing.
  extra: {
    max: parsePositiveInt(process.env.DB_POOL_MAX, 30),
    min: parsePositiveInt(process.env.DB_POOL_MIN, 5),
    idleTimeoutMillis: parsePositiveInt(process.env.DB_IDLE_TIMEOUT_MS, 30_000),
    statement_timeout: parsePositiveInt(
      process.env.DB_STATEMENT_TIMEOUT_MS,
      30_000,
    ),
  },
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
