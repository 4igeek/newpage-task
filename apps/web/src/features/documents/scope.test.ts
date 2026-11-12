import type { DocumentDto } from '@docchat/shared';
import { describe, expect, it } from 'vitest';
import { resolveScope } from './scope';

const doc = (id: string, status: DocumentDto['status'] = 'ready'): DocumentDto => ({
  id,
  filename: `${id}.md`,
  mimeType: 'text/markdown',
  sizeBytes: 1,
  status,
  error: null,
  pageCount: null,
  chunkCount: 1,
  createdAt: '2026-11-12T10:00:00.000Z',
});

const docs = [doc('a'), doc('b'), doc('c'), doc('p', 'processing')];

describe('resolveScope', () => {
  it('searches everything when nothing is selected', () => {
    expect(resolveScope(new Set(), docs)).toEqual({ documentIds: undefined, count: 3, total: 3 });
  });

  it('restricts to the selected ready documents', () => {
    expect(resolveScope(new Set(['a', 'c']), docs)).toEqual({
      documentIds: ['a', 'c'],
      count: 2,
      total: 3,
    });
  });

  it('ignores selected documents that were deleted or are not ready', () => {
    expect(resolveScope(new Set(['a', 'deleted', 'p']), docs).documentIds).toEqual(['a']);
  });

  it('falls back to everything when no selected document is usable', () => {
    expect(resolveScope(new Set(['deleted']), docs).documentIds).toBeUndefined();
  });

  it('sends no filter when every ready document is selected', () => {
    expect(resolveScope(new Set(['a', 'b', 'c']), docs).documentIds).toBeUndefined();
  });
});
