import type { ChatEvent, ChatRequest } from '@docchat/shared';
import { describe, expect, it } from 'vitest';
import { LLMError } from '../../src/domain/errors.js';
import type { ChunkHit, ChunkSearch } from '../../src/ports/index.js';
import { AnswerQuestion, NO_RELEVANT_SOURCES_ANSWER } from '../../src/services/answer-question.js';
import { Retrieve } from '../../src/services/retrieve.js';
import { FakeEmbedder, FakeLLM, InMemoryTraceStore, silentLogger } from '../fakes.js';

const hit = (n: number, score: number): ChunkHit => ({
  chunkId: `00000000-0000-0000-0000-00000000000${n}`,
  documentId: '00000000-0000-0000-0000-0000000000aa',
  filename: 'handbook.md',
  heading: `Section ${n}`,
  pageStart: null,
  pageEnd: null,
  content: `chunk ${n} content`,
  score,
});

/** Records which queries were searched and returns fixed hits. */
class FakeSearch implements ChunkSearch {
  readonly queries: string[] = [];
  constructor(private readonly similarity = 0.8) {}
  async vectorSearch() {
    return [hit(1, this.similarity), hit(2, this.similarity - 0.1)];
  }
  async keywordSearch(query: string) {
    this.queries.push(query);
    return [hit(2, 0.3)];
  }
}

function setup(opts: { llm?: FakeLLM; similarity?: number } = {}) {
  const llm = opts.llm ?? new FakeLLM();
  const search = new FakeSearch(opts.similarity);
  const retrieve = new Retrieve(new FakeEmbedder(), search, {
    candidates: 10,
    topK: 5,
    minSimilarity: 0.5,
  });
  const traces = new InMemoryTraceStore();
  const answer = new AnswerQuestion(
    { retrieve, llm, traces, logger: silentLogger },
    { historyTurns: 2, maxTokens: 1000 },
  );
  return { answer, llm, search, traces };
}

async function run(answer: AnswerQuestion, request: ChatRequest) {
  const events: ChatEvent[] = [];
  for await (const e of answer.execute(request)) events.push(e);
  const text = events
    .filter((e) => e.type === 'delta')
    .map((e) => e.text)
    .join('');
  return { events, text, last: events.at(-1) };
}

const ask = (content: string, history: ChatRequest['messages'] = []): ChatRequest => ({
  messages: [...history, { role: 'user', content }],
});

describe('AnswerQuestion', () => {
  it('emits sources first, then the streamed answer, then done with citations', async () => {
    const { answer } = setup({ llm: new FakeLLM({ answer: 'You get 27 days [1][2].' }) });

    const { events, text, last } = await run(answer, ask('How much leave?'));

    expect(events[0]).toMatchObject({ type: 'retrieval', relevant: true, rewritten: false });
    expect(events[0]?.type === 'retrieval' && events[0].sources.map((s) => s.n)).toEqual([1, 2]);
    expect(text).toBe('You get 27 days [1][2].');
    expect(last).toMatchObject({ type: 'done', outcome: 'answered', citations: [1, 2] });
  });

  it('ranks the chunk found by both searches first (hybrid fusion)', async () => {
    const { answer } = setup();
    const { events } = await run(answer, ask('q'));
    const retrieval = events[0];
    expect(retrieval?.type === 'retrieval' && retrieval.sources[0]).toMatchObject({
      heading: 'Section 2',
      vectorRank: 2,
      keywordRank: 1,
    });
  });

  it('reports citations that point at no source', async () => {
    const { answer } = setup({ llm: new FakeLLM({ answer: 'Yes [1], also [9].' }) });
    const { last } = await run(answer, ask('q'));
    expect(last).toMatchObject({ type: 'done', citations: [1], invalidCitations: [9] });
  });

  it('skips the LLM entirely when nothing relevant is found', async () => {
    const llm = new FakeLLM();
    const { answer } = setup({ llm, similarity: 0.3 });

    const { text, last } = await run(answer, ask('What is the capital of France?'));

    expect(text).toBe(NO_RELEVANT_SOURCES_ANSWER);
    expect(last).toMatchObject({ type: 'done', outcome: 'no_relevant_sources' });
    expect(llm.requests).toHaveLength(0);
  });

  it('rewrites a follow-up into a standalone query before searching', async () => {
    const llm = new FakeLLM({ rewriteTo: 'Grower plan SMS frost alerts' });
    const { answer, search } = setup({ llm });

    const { events } = await run(
      answer,
      ask('does it have SMS alerts?', [
        { role: 'user', content: 'Tell me about the Grower plan' },
        { role: 'assistant', content: 'It costs £29 [1].' },
      ]),
    );

    expect(search.queries).toEqual(['Grower plan SMS frost alerts']);
    expect(events[0]).toMatchObject({ query: 'Grower plan SMS frost alerts', rewritten: true });
  });

  it('does not call the LLM to rewrite the first question', async () => {
    const llm = new FakeLLM();
    const { answer } = setup({ llm });
    await run(answer, ask('first question'));
    expect(llm.requests.map((r) => r.kind)).toEqual(['stream']);
  });

  it('falls back to the raw question if rewriting fails', async () => {
    const llm = new FakeLLM({ failRewrite: true });
    const { answer, search } = setup({ llm });

    await run(
      answer,
      ask('follow up', [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ]),
    );

    expect(search.queries).toEqual(['follow up']);
  });

  it('sends only the last N turns of history, with sources on the latest question only', async () => {
    const llm = new FakeLLM();
    const { answer } = setup({ llm });
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i}`,
    }));

    await run(answer, ask('latest', history));

    const sent = llm.requests.find((r) => r.kind === 'stream')?.request.messages ?? [];
    expect(sent.map((m) => m.content.slice(0, 6))).toEqual([
      'turn 6',
      'turn 7',
      'turn 8',
      'turn 9',
      '<sourc',
    ]);
  });

  it('still shows sources but reports an error when the LLM is unavailable', async () => {
    const llm = new FakeLLM({
      error: new LLMError('LLM_NOT_CONFIGURED', 'Set ANTHROPIC_API_KEY to enable answers.'),
    });
    const { answer } = setup({ llm });

    const { events, last } = await run(answer, ask('q'));

    expect(events[0]).toMatchObject({ type: 'retrieval', relevant: true });
    expect(last).toEqual({
      type: 'error',
      code: 'LLM_NOT_CONFIGURED',
      message: 'Set ANTHROPIC_API_KEY to enable answers.',
    });
  });

  it.each([
    ['refusal', 'refused'],
    ['max_tokens', 'truncated'],
  ] as const)('maps a %s stop to the %s outcome', async (stopReason, outcome) => {
    const { answer } = setup({ llm: new FakeLLM({ stopReason }) });
    const { last } = await run(answer, ask('q'));
    expect(last).toMatchObject({ type: 'done', outcome });
  });
});

describe('AnswerQuestion tracing', () => {
  it('records a trace for an answered question, including which sources were cited', async () => {
    const { answer, traces } = setup({ llm: new FakeLLM({ answer: 'Yes [2], and [9].' }) });

    const events: ChatEvent[] = [];
    for await (const e of answer.execute(ask('How much leave?'), { requestId: 'req-42' })) {
      events.push(e);
    }

    expect(events.at(-1)).toMatchObject({ type: 'done', requestId: 'req-42' });
    expect(traces.traces).toHaveLength(1);
    const [trace] = traces.traces;
    expect(trace).toMatchObject({
      requestId: 'req-42',
      question: 'How much leave?',
      outcome: 'answered',
      answer: 'Yes [2], and [9].',
      citations: [2],
      invalidCitations: [9],
      inputTokens: 100,
      outputTokens: 20,
    });
    expect(trace?.sources.map((s) => [s.n, s.cited])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('records gated and failed questions too', async () => {
    const gated = setup({ similarity: 0.2 });
    await run(gated.answer, ask('off topic'));
    expect(gated.traces.traces[0]).toMatchObject({
      outcome: 'no_relevant_sources',
      inputTokens: 0,
    });

    const failed = setup({
      llm: new FakeLLM({ error: new LLMError('LLM_RATE_LIMITED', 'slow down') }),
    });
    await run(failed.answer, ask('q'));
    expect(failed.traces.traces[0]).toMatchObject({
      outcome: 'error',
      errorCode: 'LLM_RATE_LIMITED',
    });
  });

  it('records an aborted trace when the user stops mid-answer', async () => {
    const { answer, traces } = setup({
      llm: new FakeLLM({ answer: 'A long answer that streams.' }),
    });
    const controller = new AbortController();

    for await (const e of answer.execute(ask('q'), { signal: controller.signal })) {
      if (e.type === 'delta') {
        controller.abort();
        break; // what the route does when the client disconnects
      }
    }

    expect(traces.traces).toHaveLength(1);
    expect(traces.traces[0]?.outcome).toBe('aborted');
  });

  it('still delivers the answer if recording the trace fails', async () => {
    const { answer, traces } = setup();
    traces.failWith = new Error('database down');

    const { last } = await run(answer, ask('q'));

    expect(last).toMatchObject({ type: 'done', outcome: 'answered' });
  });
});
