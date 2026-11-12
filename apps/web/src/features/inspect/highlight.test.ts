import { describe, expect, it } from 'vitest';
import { highlight, queryStems } from './highlight';

const matched = (text: string, query: string) =>
  highlight(text, query)
    .filter((s) => s.match)
    .map((s) => s.text);

describe('queryStems', () => {
  it('drops stop words and short words, and stems by prefix', () => {
    expect(queryStems('How much annual leave do I get?')).toEqual(['much', 'annu', 'leav']);
  });

  it('keeps numbers and de-duplicates', () => {
    expect(queryStems('SEV1 incidents and SEV1 pages within 15 minutes')).toEqual([
      'sev1',
      'inciden',
      'page',
      'minut',
    ]);
  });
});

describe('highlight', () => {
  it('marks words that share a stem with the query, keeping the rest intact', () => {
    const text = 'Up to five unused days can be carried over.';
    const segments = highlight(text, 'can I carry unused leave over?');

    expect(segments.map((s) => s.text).join('')).toBe(text);
    // Offsets point back into the original text.
    for (const seg of segments)
      expect(text.slice(seg.offset, seg.offset + seg.text.length)).toBe(seg.text);
    expect(matched(text, 'can I carry unused leave over?')).toEqual(['unused', 'carried', 'over']);
  });

  it('is case-insensitive', () => {
    expect(matched('Annual Leave', 'annual leave')).toEqual(['Annual', 'Leave']);
  });

  it('returns the text unhighlighted when the query has no useful words', () => {
    expect(highlight('Some text.', 'how is it?')).toEqual([
      { text: 'Some text.', match: false, offset: 0 },
    ]);
  });
});
