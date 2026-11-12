import { PermanentIngestionError } from '../domain/errors.js';
import type { JobQueue, Logger } from '../ports/index.js';
import type { IngestDocument } from './ingest-document.js';

export interface WorkerSettings {
  pollIntervalMs: number;
  maxAttempts: number;
  /** Base for exponential backoff: base, 2*base, 4*base... */
  retryBaseMs: number;
}

/**
 * Processes one job. Returns false when the queue was empty, so the caller
 * can back off. Kept separate from the polling loop so it is easy to test.
 */
export async function processNextJob(deps: {
  queue: JobQueue;
  ingest: Pick<IngestDocument, 'execute'>;
  onPermanentFailure: (documentId: string, error: string) => Promise<void>;
  logger: Logger;
  settings: WorkerSettings;
}): Promise<boolean> {
  const { queue, ingest, onPermanentFailure, logger, settings } = deps;
  const job = await queue.claim();
  if (!job) return false;

  try {
    await ingest.execute(job.documentId);
    await queue.complete(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable =
      !(err instanceof PermanentIngestionError) && job.attempts < settings.maxAttempts;
    const retryAfterMs = retryable ? settings.retryBaseMs * 2 ** (job.attempts - 1) : null;

    logger.error(
      { err, jobId: job.id, documentId: job.documentId, attempt: job.attempts, retryAfterMs },
      'job failed',
    );
    await queue.fail(job.id, message, retryAfterMs);
    if (retryAfterMs === null) await onPermanentFailure(job.documentId, message);
  }
  return true;
}

/** Polls until `signal` is aborted. Drains back-to-back jobs without sleeping. */
export async function runWorker(
  deps: Parameters<typeof processNextJob>[0],
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    const didWork = await processNextJob(deps).catch((err: unknown) => {
      // Queue/DB errors: log and keep the worker alive; the next poll retries.
      deps.logger.error({ err }, 'worker loop error');
      return false;
    });
    if (!didWork) await sleep(deps.settings.pollIntervalMs, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
