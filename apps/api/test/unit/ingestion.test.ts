import { getEventListeners } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { DefaultDocumentParser } from '../../src/adapters/document-parser.js';
import type { Job, JobQueue } from '../../src/ports/index.js';
import { IngestDocument } from '../../src/services/ingest-document.js';
import { processNextJob, runWorker } from '../../src/services/run-worker.js';
import { UploadDocument } from '../../src/services/upload-document.js';
import {
  FakeEmbedder,
  InMemoryBlobStore,
  InMemoryChunkRepository,
  InMemoryDocumentRepository,
  silentLogger,
} from '../fakes.js';

function setup() {
  const documents = new InMemoryDocumentRepository();
  const chunks = new InMemoryChunkRepository();
  const blobs = new InMemoryBlobStore();
  const embedder = new FakeEmbedder();
  const upload = new UploadDocument(documents, blobs);
  const ingest = new IngestDocument(
    {
      documents,
      chunks,
      blobs,
      parser: new DefaultDocumentParser(),
      embedder,
      logger: silentLogger,
    },
    { targetTokens: 50, overlapTokens: 10 },
  );
  return { documents, chunks, blobs, embedder, upload, ingest };
}

const MARKDOWN = [
  '# Handbook',
  'Welcome to the team.',
  '## Holidays',
  'Everyone gets 25 days of annual leave plus bank holidays.',
  '## Expenses',
  'Submit receipts within 30 days through the finance portal.',
].join('\n');

describe('IngestDocument', () => {
  it('parses, chunks, embeds and stores a document, then marks it ready', async () => {
    const { upload, ingest, documents, chunks, embedder } = setup();
    const { document } = await upload.execute({
      filename: 'handbook.md',
      bytes: Buffer.from(MARKDOWN),
    });

    await ingest.execute(document.id);

    const stored = chunks.byDocument.get(document.id) ?? [];
    expect(stored.map((c) => c.heading)).toEqual([
      'Handbook',
      'Handbook > Holidays',
      'Handbook > Expenses',
    ]);
    expect(stored.every((c) => c.embedding.length === 384)).toBe(true);
    expect((await documents.findById(document.id))?.status).toBe('ready');
    expect(embedder.calls.every((c) => c.kind === 'document')).toBe(true);
  });

  it('embeds each chunk with a contextual header (filename + heading)', async () => {
    const { upload, ingest, embedder } = setup();
    const { document } = await upload.execute({
      filename: 'handbook.md',
      bytes: Buffer.from(MARKDOWN),
    });

    await ingest.execute(document.id);

    expect(embedder.calls[0]?.texts[1]).toBe(
      'handbook.md\nHandbook > Holidays\nEveryone gets 25 days of annual leave plus bank holidays.',
    );
  });

  it('is idempotent: re-running replaces chunks rather than duplicating them', async () => {
    const { upload, ingest, chunks } = setup();
    const { document } = await upload.execute({ filename: 'h.md', bytes: Buffer.from(MARKDOWN) });

    await ingest.execute(document.id);
    await ingest.execute(document.id);

    expect(chunks.byDocument.get(document.id)).toHaveLength(3);
  });

  it('fails permanently when no text can be extracted', async () => {
    const { upload, ingest } = setup();
    const { document } = await upload.execute({
      filename: 'blank.txt',
      bytes: Buffer.from('  \n '),
    });

    await expect(ingest.execute(document.id)).rejects.toMatchObject({
      code: 'NO_EXTRACTABLE_TEXT',
    });
  });

  it('skips quietly when the document was deleted before the job ran', async () => {
    const { ingest } = setup();
    await expect(ingest.execute('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });
});

describe('processNextJob', () => {
  const settings = { pollIntervalMs: 10, maxAttempts: 3, retryBaseMs: 1000 };
  const job = (attempts: number): Job => ({
    id: 'job-1',
    type: 'ingest_document',
    documentId: 'doc-1',
    attempts,
  });
  const queueWith = (j: Job | null): JobQueue => ({
    claim: vi.fn(async () => j),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  });
  const ingestThat = (impl: () => Promise<void>) => ({ execute: vi.fn(impl) });

  it('returns false when the queue is empty', async () => {
    const queue = queueWith(null);
    const ran = await processNextJob({
      queue,
      ingest: ingestThat(async () => {}),
      onPermanentFailure: vi.fn(),
      logger: silentLogger,
      settings,
    });
    expect(ran).toBe(false);
  });

  it('completes a successful job', async () => {
    const queue = queueWith(job(1));
    await processNextJob({
      queue,
      ingest: ingestThat(async () => {}),
      onPermanentFailure: vi.fn(),
      logger: silentLogger,
      settings,
    });
    expect(queue.complete).toHaveBeenCalledWith('job-1');
  });

  it('retries transient failures with exponential backoff', async () => {
    const queue = queueWith(job(2));
    const onPermanentFailure = vi.fn();
    await processNextJob({
      queue,
      ingest: ingestThat(async () => {
        throw new Error('db blip');
      }),
      onPermanentFailure,
      logger: silentLogger,
      settings,
    });
    expect(queue.fail).toHaveBeenCalledWith('job-1', 'db blip', 2000);
    expect(onPermanentFailure).not.toHaveBeenCalled();
  });

  it('gives up after the last attempt and marks the document failed', async () => {
    const queue = queueWith(job(3));
    const onPermanentFailure = vi.fn(async () => {});
    await processNextJob({
      queue,
      ingest: ingestThat(async () => {
        throw new Error('still broken');
      }),
      onPermanentFailure,
      logger: silentLogger,
      settings,
    });
    expect(queue.fail).toHaveBeenCalledWith('job-1', 'still broken', null);
    expect(onPermanentFailure).toHaveBeenCalledWith('doc-1', 'still broken');
  });
});

describe('runWorker', () => {
  it('does not leave an abort listener behind for each idle poll', async () => {
    const controller = new AbortController();
    let polls = 0;
    const queue: JobQueue = {
      claim: vi.fn(async () => {
        if (++polls === 20) controller.abort();
        return null;
      }),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
    };
    const listenersBefore = getEventListeners(controller.signal, 'abort').length;
    const running = runWorker(
      {
        queue,
        ingest: { execute: vi.fn(async () => {}) },
        onPermanentFailure: vi.fn(),
        logger: silentLogger,
        settings: { pollIntervalMs: 1, maxAttempts: 3, retryBaseMs: 1000 },
      },
      controller.signal,
    );
    // Sample mid-run: the old sleep added one listener per poll and never removed it.
    await new Promise((r) => setTimeout(r, 15));
    expect(getEventListeners(controller.signal, 'abort').length).toBeLessThanOrEqual(
      listenersBefore + 1,
    );
    await running;
    expect(polls).toBe(20);
  });
});
