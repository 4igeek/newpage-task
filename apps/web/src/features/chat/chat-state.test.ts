import { describe, expect, it } from 'vitest';
import { type AssistantTurn, applyEvent, isBusy, type Turn, toRequestMessages } from './chat-state';

const pending = (): AssistantTurn => ({
  id: 'a',
  role: 'assistant',
  content: '',
  status: 'retrieving',
});

const retrieval = {
  type: 'retrieval' as const,
  query: 'q',
  rewritten: false,
  relevant: true,
  sources: [],
  stats: { vectorHits: 0, keywordHits: 0, topSimilarity: null },
};

const done = (outcome: 'answered' | 'no_relevant_sources' = 'answered') => ({
  type: 'done' as const,
  outcome,
  citations: [],
  invalidCitations: [],
  model: 'm',
  requestId: 'req-1',
  usage: { inputTokens: 1, outputTokens: 1 },
  timings: { rewriteMs: 0, retrievalMs: 1, firstTokenMs: 2, totalMs: 3 },
});

describe('applyEvent', () => {
  it('follows a full stream: retrieval, deltas, done', () => {
    let turn = pending();
    turn = applyEvent(turn, retrieval);
    expect(turn.status).toBe('streaming');
    turn = applyEvent(turn, { type: 'delta', text: 'Hel' });
    turn = applyEvent(turn, { type: 'delta', text: 'lo [1].' });
    turn = applyEvent(turn, done());
    expect(turn).toMatchObject({ content: 'Hello [1].', status: 'done', retrieval, done: done() });
  });

  it('records an error and keeps what was already received', () => {
    const turn = applyEvent(applyEvent(pending(), retrieval), {
      type: 'error',
      code: 'LLM_NOT_CONFIGURED',
      message: 'no key',
    });
    expect(turn).toMatchObject({
      status: 'error',
      retrieval,
      error: { code: 'LLM_NOT_CONFIGURED', message: 'no key' },
    });
  });
});

describe('toRequestMessages', () => {
  const user = (content: string): Turn => ({ id: content, role: 'user', content });
  const answer = (content: string, overrides: Partial<AssistantTurn> = {}): Turn => ({
    id: `a-${content}`,
    role: 'assistant',
    content,
    status: 'done',
    done: done(),
    ...overrides,
  });

  it('sends completed answers as history, followed by the new question', () => {
    expect(toRequestMessages([user('q1'), answer('a1')], 'q2')).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]);
  });

  it('leaves out errored, stopped and "nothing found" replies', () => {
    const turns = [
      user('q1'),
      answer('', { status: 'error' }),
      user('q2'),
      answer('partial', { status: 'stopped', done: undefined }),
      user('q3'),
      answer('not found', { done: done('no_relevant_sources') }),
    ];
    expect(toRequestMessages(turns, 'q4').map((m) => m.content)).toEqual(['q1', 'q2', 'q3', 'q4']);
  });
});

describe('isBusy', () => {
  it('is true only while the last answer is in flight', () => {
    expect(isBusy([])).toBe(false);
    expect(isBusy([pending()])).toBe(true);
    expect(isBusy([{ ...pending(), status: 'done' }])).toBe(false);
  });
});
