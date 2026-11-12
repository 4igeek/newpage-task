import type { DocumentDto } from '@docchat/shared';
import { describe, expect, it } from 'vitest';
import { describeDocument, formatBytes, plural } from './format';

const doc = (overrides: Partial<DocumentDto> = {}): DocumentDto => ({
  id: '00000000-0000-0000-0000-000000000001',
  filename: 'runbook.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 3270,
  status: 'ready',
  error: null,
  pageCount: 3,
  chunkCount: 2,
  createdAt: '2026-11-12T10:00:00.000Z',
  ...overrides,
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2.0 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('formats %d as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('describeDocument', () => {
  it('summarises a ready PDF', () => {
    expect(describeDocument(doc())).toBe('PDF · 3 pages · 2 chunks · 3.2 KB');
  });

  it('omits pages for formats without them, and chunks until ready', () => {
    expect(
      describeDocument(doc({ mimeType: 'text/markdown', pageCount: null, status: 'processing' })),
    ).toBe('Markdown · 3.2 KB');
  });
});

describe('plural', () => {
  it('uses the singular for one', () => {
    expect(plural(1, 'page')).toBe('1 page');
    expect(plural(2, 'page')).toBe('2 pages');
  });
});
