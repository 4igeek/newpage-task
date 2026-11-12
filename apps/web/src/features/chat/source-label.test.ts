import type { SourceDto } from '@docchat/shared';
import { describe, expect, it } from 'vitest';
import { pagesLabel, sectionName, sourceLabel } from './source-label';

const source = (overrides: Partial<SourceDto>): SourceDto => ({
  n: 1,
  chunkId: '00000000-0000-0000-0000-000000000001',
  documentId: '00000000-0000-0000-0000-000000000002',
  filename: 'handbook.md',
  heading: null,
  pageStart: null,
  pageEnd: null,
  content: '',
  similarity: null,
  vectorRank: null,
  keywordRank: null,
  ...overrides,
});

describe('source labels', () => {
  it('uses the most specific heading', () => {
    expect(sectionName('Handbook > Leave > Sick Leave')).toBe('Sick Leave');
    expect(sectionName(null)).toBeNull();
  });

  it('formats single pages and ranges', () => {
    expect(pagesLabel({ pageStart: 3, pageEnd: 3 })).toBe('p. 3');
    expect(pagesLabel({ pageStart: 1, pageEnd: 2 })).toBe('pp. 1–2');
    expect(pagesLabel({ pageStart: null, pageEnd: null })).toBeNull();
  });

  it('combines filename, section and pages', () => {
    expect(sourceLabel(source({ heading: 'Handbook > Expenses' }))).toBe('handbook.md · Expenses');
    expect(sourceLabel(source({ filename: 'r.pdf', pageStart: 1, pageEnd: 2 }))).toBe(
      'r.pdf · pp. 1–2',
    );
  });
});
