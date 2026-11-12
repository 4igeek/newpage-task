import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../src/domain/markdown.js';

describe('parseMarkdown', () => {
  it('produces one section per heading with the full heading path', () => {
    const md = [
      '# Guide',
      'intro',
      '## Install',
      'run it',
      '### Docker',
      'compose up',
      '## Usage',
      'ask',
    ].join('\n');

    expect(parseMarkdown(md)).toEqual([
      { heading: 'Guide', text: 'intro' },
      { heading: 'Guide > Install', text: 'run it' },
      { heading: 'Guide > Install > Docker', text: 'compose up' },
      { heading: 'Guide > Usage', text: 'ask' },
    ]);
  });

  it('keeps text before the first heading without a heading', () => {
    expect(parseMarkdown('preamble\n# A\nbody')).toEqual([
      { text: 'preamble' },
      { heading: 'A', text: 'body' },
    ]);
  });

  it('handles skipped heading levels', () => {
    const md = '# A\n### C\nc\n### D\nd\n## B\nb';
    expect(parseMarkdown(md).map((s) => s.heading)).toEqual(['A > C', 'A > D', 'A > B']);
  });

  it('ignores # lines inside fenced code blocks', () => {
    const md = '# Real\n```bash\n# just a comment\necho hi\n```';
    const sections = parseMarkdown(md);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.text).toContain('# just a comment');
  });

  it('drops headings with no body', () => {
    expect(parseMarkdown('# Empty\n## Also empty\n## Full\nx')).toEqual([
      { heading: 'Empty > Full', text: 'x' },
    ]);
  });
});
