import type { Section } from './sections.js';

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Splits Markdown into one section per heading, tracking the heading path
 * ("Guide > Install > Docker") so each chunk knows where it came from.
 * Headings inside fenced code blocks are ignored.
 */
export function parseMarkdown(source: string): Section[] {
  const sections: Section[] = [];
  // Stack of open headings; a new heading closes every heading at its level or deeper.
  const stack: { level: number; text: string }[] = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      const heading = stack.map((h) => h.text).join(' > ');
      sections.push(heading ? { text, heading } : { text });
    }
    buffer = [];
  };

  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    const match = inFence ? null : HEADING.exec(line);
    if (match?.[1] && match[2]) {
      flush();
      const level = match[1].length;
      while ((stack.at(-1)?.level ?? 0) >= level) stack.pop();
      stack.push({ level, text: match[2] });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}
