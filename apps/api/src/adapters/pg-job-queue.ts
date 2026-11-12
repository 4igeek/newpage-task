import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { jobs } from '../db/schema.js';
import type { Job, JobQueue } from '../ports/index.js';

/**
 * Postgres-backed job queue.
 *
 * `FOR UPDATE SKIP LOCKED` lets any number of workers poll concurrently: each
 * claim locks one row and the others skip it instead of waiting. A job whose
 * worker died mid-run (lock older than `staleAfter`) becomes claimable again.
 */
export class PgJobQueue implements JobQueue {
  constructor(
    private readonly db: Database,
    private readonly staleAfter = '10 minutes',
  ) {}

  async claim(): Promise<Job | null> {
    const rows = await this.db.execute<{
      id: string;
      type: string;
      document_id: string;
      attempts: number;
    }>(sql`
      update ${jobs}
      set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
      where id = (
        select id from ${jobs}
        where (status = 'queued' and run_after <= now())
           or (status = 'running' and locked_at < now() - ${this.staleAfter}::interval)
        order by run_after
        for update skip locked
        limit 1
      )
      returning id, type, document_id, attempts
    `);
    const row = rows[0];
    if (!row) return null;
    if (row.type !== 'ingest_document') throw new Error(`Unknown job type: ${row.type}`);
    return { id: row.id, type: row.type, documentId: row.document_id, attempts: row.attempts };
  }

  async complete(jobId: string) {
    await this.db
      .update(jobs)
      .set({ status: 'done', lockedAt: null, lastError: null })
      .where(eq(jobs.id, jobId));
  }

  async fail(jobId: string, error: string, retryAfterMs: number | null) {
    await this.db
      .update(jobs)
      .set(
        retryAfterMs === null
          ? { status: 'failed', lockedAt: null, lastError: error }
          : {
              status: 'queued',
              lockedAt: null,
              lastError: error,
              runAfter: sql`now() + ${`${retryAfterMs} milliseconds`}::interval`,
            },
      )
      .where(eq(jobs.id, jobId));
  }
}
