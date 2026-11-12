import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>['db'];

export function createDatabase(url: string) {
  const client = postgres(url, { max: 10 });
  const db = drizzle(client, { schema, casing: 'snake_case' });

  return {
    db,
    async ping(): Promise<void> {
      await db.execute(sql`select 1`);
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}
