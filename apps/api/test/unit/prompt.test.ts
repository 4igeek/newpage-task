import { describe, expect, it } from 'vitest';
import {
  buildAnswerMessages,
  buildRewriteMessages,
  extractCitations,
  formatSources,
  type PromptSource,
} from '../../src/domain/prompt.js';

const source = (n: number, extra: Partial<PromptSource> = {}): PromptSource => ({
  n,
  filename: 'handbook.md',
  heading: 'Leave',
  pageStart: null,
  pageEnd: null,
  content: `content ${n}`,
  ...extra,
});

describe('formatSources', () => {
  it('wraps each source with its number and metadata', () => {
    expect(
      formatSources([
        source(1),
        source(2, { filename: 'r.pdf', heading: null, pageStart: 3, pageEnd: 4 }),
      ]),
    ).toBe(
      [
        '<sources>',
        '<source id="1" document="handbook.md" section="Leave">',
        'content 1',
        '</source>',
        '<source id="2" document="r.pdf" pages="3-4">',
        'content 2',
        '</source>',
        '</sources>',
      ].join('\n'),
    );
  });

  it('escapes attribute values so a filename cannot break out of the tag', () => {
    expect(formatSources([source(1, { filename: 'a"><evil>.md' })])).toContain(
      'document="a&quot;>&lt;evil>.md"',
    );
  });
});

describe('buildAnswerMessages', () => {
  it('attaches sources to the latest question only and strips old citations', () => {
    const messages = buildAnswerMessages(
      [
        { role: 'user', content: 'How much leave?' },
        { role: 'assistant', content: 'You get 27 days [1].' },
      ],
      'And sick leave?',
      [source(1)],
    );

    expect(messages[1]?.content).toBe('You get 27 days.');
    expect(messages[2]?.role).toBe('user');
    expect(messages[2]?.content).toContain('<source id="1"');
    expect(messages[2]?.content).toContain('<question>\nAnd sick leave?\n</question>');
  });
});

describe('buildRewriteMessages', () => {
  it('includes the transcript and the latest message', () => {
    const [message] = buildRewriteMessages(
      [
        { role: 'user', content: 'Tell me about the Grower plan' },
        { role: 'assistant', content: 'It costs £29 [2].' },
      ],
      'does it have SMS alerts?',
    );
    expect(message?.content).toContain('User: Tell me about the Grower plan');
    expect(message?.content).toContain('Assistant: It costs £29.');
    expect(message?.content).toContain('<latest_message>\ndoes it have SMS alerts?');
  });
});

describe('extractCitations', () => {
  it('separates valid citations from ones that reference no source', () => {
    expect(extractCitations('A [1]. B [3][1]. C [7]. D [0].', 3)).toEqual({
      valid: [1, 3],
      invalid: [0, 7],
    });
  });

  it('returns nothing for an answer without citations', () => {
    expect(extractCitations('No sources here.', 3)).toEqual({ valid: [], invalid: [] });
  });
});
