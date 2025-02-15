import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
// Import other entities as needed

config(); // Load .env file

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT!, 10) || 5432,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: ['dist/common/entities/*.entity.js'],
  migrations: ['dist/database/migrations/*.js'], // Point to compiled JS files
  synchronize: false, // Set to false in production
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  logging: true,
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
