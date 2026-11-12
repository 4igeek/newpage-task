/**
 * Highlights query words in a retrieved passage, so a reader can see at a
 * glance why it matched. Deliberately rough: it mirrors what keyword search
 * does (drop stop words, loose stemming by prefix), not what the embedding
 * model "saw", which can't be shown as words.
 */

const STOP_WORDS = new Set(
  'a an and are as at be but by can do does for from get got has have how i if in into is it its me my of on or our so than that the their them then there these they this to too was we were what when where which who why will with you your about after also any been being could did should would within without'.split(
    ' ',
  ),
);

export interface Segment {
  text: string;
  match: boolean;
  /** Character offset in the original text; a stable React key. */
  offset: number;
}

/** Query words worth highlighting, reduced to a prefix so "carry" also finds "carried". */
export function queryStems(query: string): string[] {
  const words = query.toLowerCase().match(/\p{L}[\p{L}\p{N}'-]*|\p{N}+/gu) ?? [];
  const stems = words
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map((w) => (w.length <= 5 ? w.slice(0, 4) : w.slice(0, w.length - 2)));
  return [...new Set(stems)];
}

export function highlight(text: string, query: string): Segment[] {
  const stems = queryStems(query);
  if (stems.length === 0) return [{ text, match: false, offset: 0 }];

  // Splitting on a capture group keeps the words *and* the text between them.
  let offset = 0;
  return text
    .split(/(\p{L}[\p{L}\p{N}'-]*|\p{N}+)/u)
    .filter((part) => part !== '')
    .map((part) => {
      const lower = part.toLowerCase();
      const segment = { text: part, match: stems.some((s) => lower.startsWith(s)), offset };
      offset += part.length;
      return segment;
    });
}
