/**
 * One-shot migration runner. Runs as its own container in docker-compose,
 * before the API and worker start, so app processes never race to migrate.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadConfig } from '../config.js';

const config = loadConfig();
const client = postgres(config.DATABASE_URL, { max: 1 });

try {
  await migrate(drizzle(client), {
    migrationsFolder: new URL('../../drizzle', import.meta.url).pathname,
  });
  console.log('Migrations applied');
} finally {
  await client.end();
}
