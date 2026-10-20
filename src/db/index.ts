import 'dotenv/config';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema';

/**
 * MySQL connection pool for the development database.
 * Configuration is read from environment variables (see .env.example).
 */
export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'kibrain_dev',
  waitForConnections: true,
  connectionLimit: 10,
});

/**
 * Drizzle ORM instance bound to the MySQL pool.
 */
export const db = drizzle(pool, { schema, mode: 'default' });

export * from './schema';
