import { describe, expect, it } from 'vitest';
import { type ChunkingOptions, chunkSections } from '../../src/domain/chunker.js';

// One token per word keeps the arithmetic in these tests easy to follow.
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const opts: ChunkingOptions = {
  targetTokens: 10,
  overlapTokens: 3,
  maxTokens: 20,
  countTokens: words,
};

const sentence = (n: number, tag: string) =>
  `${Array.from({ length: n - 1 }, () => tag).join(' ')} end.`;

describe('chunkSections', () => {
  it('keeps a small section as a single chunk with its metadata', () => {
    const chunks = chunkSections([{ text: 'a short section', heading: 'Intro', page: 2 }], opts);

    expect(chunks).toEqual([
      {
        ordinal: 0,
        content: 'a short section',
        heading: 'Intro',
        pageStart: 2,
        pageEnd: 2,
        tokenCount: 3,
      },
    ]);
  });

  it('never exceeds the target size when units fit', () => {
    const text = Array.from({ length: 12 }, (_, i) => sentence(4, `w${i}`)).join(' ');
    const chunks = chunkSections([{ text }], opts);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(opts.targetTokens);
  });

  it('starts a new chunk on every heading change, even when small', () => {
    const chunks = chunkSections(
      [
        { text: 'alpha', heading: 'A' },
        { text: 'beta', heading: 'B' },
      ],
      opts,
    );
    expect(chunks.map((c) => [c.heading, c.content])).toEqual([
      ['A', 'alpha'],
      ['B', 'beta'],
    ]);
  });

  it('merges consecutive pages under the same heading and records the page range', () => {
    const chunks = chunkSections(
      [
        { text: 'end of page one', page: 1 },
        { text: 'start of page two', page: 2 },
      ],
      opts,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 2 });
  });

  it('repeats trailing context at the start of the next chunk (overlap)', () => {
    // Three 3-word paragraphs per chunk fit in 10 tokens; the 4th forces a split.
    const text = [
      'one two three.',
      'four five six.',
      'seven eight nine.',
      'ten eleven twelve.',
    ].join('\n\n');
    const [first, second] = chunkSections([{ text }], opts);

    expect(first?.content).toContain('seven eight nine.');
    expect(second?.content.startsWith('seven eight nine.')).toBe(true);
    expect(second?.content).toContain('ten eleven twelve.');
  });

  it('does not overlap across a heading change', () => {
    const chunks = chunkSections(
      [
        { text: 'one two three.\n\nfour five six.', heading: 'A' },
        { text: 'seven eight.', heading: 'B' },
      ],
      opts,
    );
    expect(chunks[1]?.content).toBe('seven eight.');
  });

  it('splits an oversized sentence with no punctuation into word windows', () => {
    const text = Array.from({ length: 25 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkSections([{ text }], { ...opts, overlapTokens: 0 });

    expect(chunks.map((c) => c.tokenCount)).toEqual([10, 10, 5]);
  });

  it('numbers chunks sequentially and skips empty sections', () => {
    const chunks = chunkSections(
      [{ text: '   ' }, { text: 'a', heading: 'X' }, { text: 'b', heading: 'Y' }],
      opts,
    );
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1]);
  });
});
