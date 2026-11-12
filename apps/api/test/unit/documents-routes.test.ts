import { describe, expect, it } from 'vitest';
import { buildTestApp, multipartFile } from '../fakes.js';

describe('document routes', () => {
  it('uploads a markdown file, stores the blob and queues ingestion', async () => {
    const { app, documents, blobs } = buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      ...multipartFile('guide.md', '# Hello\nworld'),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.created).toBe(true);
    expect(body.document).toMatchObject({
      filename: 'guide.md',
      mimeType: 'text/markdown',
      status: 'pending',
      chunkCount: 0,
    });
    expect(documents.enqueuedJobs).toEqual([body.document.id]);
    expect(blobs.blobs.size).toBe(1);
  });

  it('deduplicates identical uploads by content hash', async () => {
    const { app, documents } = buildTestApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/documents',
      ...multipartFile('a.txt', 'same bytes'),
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/documents',
      ...multipartFile('renamed.txt', 'same bytes'),
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().created).toBe(false);
    expect(second.json().document.id).toBe(first.json().document.id);
    expect(documents.enqueuedJobs).toHaveLength(1);
  });

  it('rejects unsupported file types with 415', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      ...multipartFile('photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    });

    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects empty files with 400', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      ...multipartFile('empty.txt', ''),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('EMPTY_FILE');
  });

  it('rejects files over the size limit with 413', async () => {
    const { app } = buildTestApp({ settings: { maxUploadBytes: 10 } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      ...multipartFile('big.txt', 'x'.repeat(100)),
    });
    expect(res.statusCode).toBe(413);
  });

  it('strips path components from the uploaded filename', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/documents',
      ...multipartFile('../../etc/notes.txt', 'hi'),
    });
    expect(res.json().document.filename).toBe('notes.txt');
  });

  it('lists, fetches and deletes documents', async () => {
    const { app, blobs } = buildTestApp();
    const created = await app.inject({
      method: 'POST',
      url: '/api/documents',
      ...multipartFile('a.txt', 'hello'),
    });
    const id = created.json().document.id;

    const list = await app.inject({ method: 'GET', url: '/api/documents' });
    expect(list.json().documents).toHaveLength(1);

    const one = await app.inject({ method: 'GET', url: `/api/documents/${id}` });
    expect(one.json().id).toBe(id);

    const del = await app.inject({ method: 'DELETE', url: `/api/documents/${id}` });
    expect(del.statusCode).toBe(204);
    expect(blobs.blobs.size).toBe(0);

    const gone = await app.inject({ method: 'GET', url: `/api/documents/${id}` });
    expect(gone.statusCode).toBe(404);
  });

  it('returns 400 for a malformed document id', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/documents/not-a-uuid' });
    expect(res.statusCode).toBe(400);
  });
});
