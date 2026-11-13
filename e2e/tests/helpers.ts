import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { type APIRequestContext, expect } from '@playwright/test';

export const SAMPLE_DOCS = ['employee-handbook.md', 'incident-runbook.pdf', 'product-faq.md'].map(
  (name) => resolve(import.meta.dirname, '../../sample-docs', name),
);

/** Uploads through the API (fast setup) and waits until every file is searchable. */
export async function uploadAndWaitUntilReady(request: APIRequestContext, paths: string[]) {
  for (const path of paths) {
    const res = await request.post('/api/documents', {
      multipart: {
        file: {
          name: basename(path),
          mimeType: 'application/octet-stream',
          buffer: await readFile(path),
        },
      },
    });
    expect(res.ok()).toBe(true);
  }
  const names = paths.map((p) => basename(p));
  await expect
    .poll(
      async () => {
        const { documents } = (await (await request.get('/api/documents')).json()) as {
          documents: { filename: string; status: string }[];
        };
        return names.every((n) => documents.some((d) => d.filename === n && d.status === 'ready'));
      },
      { timeout: 60_000, message: 'documents never became ready' },
    )
    .toBe(true);
}
