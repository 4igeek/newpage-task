import type { Section } from './sections.js';

export interface ChunkingOptions {
  /** Aim for chunks around this size. */
  targetTokens: number;
  /** Trailing context repeated at the start of the next chunk. */
  overlapTokens: number;
  /** Hard ceiling; must stay below the embedding model's input limit. */
  maxTokens: number;
  countTokens: (text: string) => number;
}

export interface ChunkDraft {
  ordinal: number;
  content: string;
  heading?: string;
  pageStart?: number;
  pageEnd?: number;
  tokenCount: number;
}

/** A piece of text that is never split further when packing: a paragraph, sentence or word window. */
interface Unit {
  text: string;
  tokens: number;
  heading?: string;
  page?: number;
}

/**
 * Structure-aware chunking.
 *
 * 1. Sections are broken into the largest natural units that fit (paragraph,
 *    then sentence, then a word window as a last resort).
 * 2. Units are packed greedily up to `targetTokens`.
 * 3. A heading change always starts a new chunk, so a chunk never mixes two
 *    topics and its `heading` metadata is accurate. Page changes do *not*
 *    force a split (PDF paragraphs often run across pages); the chunk records
 *    its page range instead.
 * 4. When a chunk is closed because it is full, its trailing units (up to
 *    `overlapTokens`) are repeated at the start of the next one, so a fact
 *    that straddles a boundary is retrievable from either side.
 */
export function chunkSections(sections: Section[], opts: ChunkingOptions): ChunkDraft[] {
  const units = sections.flatMap((s) => toUnits(s, opts));
  const chunks: ChunkDraft[] = [];
  let current: Unit[] = [];

  const close = () => {
    if (current.length === 0) return;
    chunks.push(toChunk(current, chunks.length, opts));
  };

  for (const unit of units) {
    const currentTokens = sumTokens(current);
    const headingChanged = current.length > 0 && current[0]?.heading !== unit.heading;

    if (headingChanged) {
      close();
      current = [unit];
    } else if (currentTokens + unit.tokens > opts.targetTokens && current.length > 0) {
      close();
      current = [...overlapTail(current, opts.overlapTokens, opts.maxTokens - unit.tokens), unit];
    } else {
      current.push(unit);
    }
  }
  close();
  return chunks;
}

function toUnits(section: Section, opts: ChunkingOptions): Unit[] {
  const meta = {
    ...(section.heading !== undefined && { heading: section.heading }),
    ...(section.page !== undefined && { page: section.page }),
  };
  const unit = (text: string): Unit => ({ text, tokens: opts.countTokens(text), ...meta });

  return splitToFit(section.text, opts)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(unit);
}

/** Recursively split text by progressively finer boundaries until each piece fits. */
function splitToFit(text: string, opts: ChunkingOptions): string[] {
  const fits = (t: string) => opts.countTokens(t) <= opts.targetTokens;
  return text.split(/\n\s*\n/).flatMap((paragraph) => {
    if (fits(paragraph)) return [paragraph];
    return paragraph.split(/(?<=[.!?])\s+/).flatMap((sentence) => {
      if (fits(sentence)) return [sentence];
      return wordWindows(sentence, opts);
    });
  });
}

function wordWindows(text: string, opts: ChunkingOptions): string[] {
  const words = text.split(/\s+/);
  const windows: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    const candidate = [...current, word].join(' ');
    if (current.length > 0 && opts.countTokens(candidate) > opts.targetTokens) {
      windows.push(current.join(' '));
      current = [word];
    } else {
      current.push(word);
    }
  }
  if (current.length) windows.push(current.join(' '));
  return windows;
}

function overlapTail(units: Unit[], overlapTokens: number, budget: number): Unit[] {
  const tail: Unit[] = [];
  let tokens = 0;
  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];
    if (!unit || tokens + unit.tokens > Math.min(overlapTokens, budget)) break;
    tail.unshift(unit);
    tokens += unit.tokens;
  }
  return tail;
}

function toChunk(units: Unit[], ordinal: number, opts: ChunkingOptions): ChunkDraft {
  const content = units.map((u) => u.text).join('\n\n');
  const pages = units.map((u) => u.page).filter((p): p is number => p !== undefined);
  const heading = units[0]?.heading;
  return {
    ordinal,
    content,
    tokenCount: opts.countTokens(content),
    ...(heading !== undefined && { heading }),
    ...(pages.length > 0 && { pageStart: Math.min(...pages), pageEnd: Math.max(...pages) }),
  };
}

function sumTokens(units: Unit[]): number {
  return units.reduce((n, u) => n + u.tokens, 0);
}

/**
 * Rough token estimate (~4 chars/token for English). Used in tests and as a
 * fallback; ingestion uses the embedding model's real tokenizer.
 */
export const approximateTokens = (text: string): number => Math.ceil(text.length / 4);
