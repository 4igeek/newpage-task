import type { AnswerOutcome, ChatEvent, ChatRequest, SourceDto } from '@docchat/shared';
import { LLMError } from '../domain/errors.js';
import {
  ANSWER_SYSTEM_PROMPT,
  buildAnswerMessages,
  buildRewriteMessages,
  type ChatTurn,
  extractCitations,
  REWRITE_SYSTEM_PROMPT,
} from '../domain/prompt.js';
import type { LLMClient, LLMUsage, Logger, QueryTrace, TraceStore } from '../ports/index.js';
import type { Retrieve } from './retrieve.js';

export const NO_RELEVANT_SOURCES_ANSWER =
  "I couldn't find anything about that in your documents. Try rephrasing, or upload a document that covers it.";

/** Each history message is capped so one huge paste can't crowd out the sources. */
const MAX_HISTORY_MESSAGE_CHARS = 2000;

export interface AnswerSettings {
  historyTurns: number;
  maxTokens: number;
}

export interface AnswerOptions {
  signal?: AbortSignal;
  /** Ties the answer to logs and its trace; normally the HTTP request ID. */
  requestId?: string;
}

/** The trace is filled in as the pipeline progresses; `outcome` is set last. */
type TraceDraft = Omit<QueryTrace, 'outcome'> & { outcome?: QueryTrace['outcome'] };

/**
 * The question-answering pipeline, as a stream of events:
 *
 *   rewrite follow-up -> retrieve -> [relevance gate] -> generate -> validate citations
 *
 * Emits `retrieval` before generation starts, so the UI can show sources
 * while the answer is still streaming. Every question, however it ends
 * (answered, gated, failed, or abandoned by the user) is recorded as a trace.
 */
export class AnswerQuestion {
  constructor(
    private readonly deps: {
      retrieve: Pick<Retrieve, 'execute'>;
      llm: LLMClient;
      traces: TraceStore;
      logger: Logger;
    },
    private readonly settings: AnswerSettings,
  ) {}

  async *execute(request: ChatRequest, options: AnswerOptions = {}): AsyncGenerator<ChatEvent> {
    const startedAt = performance.now();
    const question = request.messages.at(-1)?.content ?? '';
    const trace: TraceDraft = {
      requestId: options.requestId ?? 'unknown',
      question,
      query: question,
      rewritten: false,
      documentIds: request.documentIds ?? null,
      errorCode: null,
      model: this.deps.llm.modelId,
      answer: '',
      sources: [],
      topSimilarity: null,
      citations: [],
      invalidCitations: [],
      inputTokens: 0,
      outputTokens: 0,
      rewriteMs: 0,
      retrievalMs: null,
      firstTokenMs: null,
      totalMs: 0,
    };

    try {
      yield* this.run(request, trace, startedAt, options.signal);
    } catch (err) {
      trace.outcome = 'error';
      trace.errorCode = 'INTERNAL_ERROR';
      throw err;
    } finally {
      // Runs on success, on error, and when the consumer stops iterating
      // (the user navigated away), so every question leaves a trace.
      await this.save({
        ...trace,
        outcome: trace.outcome ?? (options.signal?.aborted ? 'aborted' : 'error'),
        totalMs: Math.round(performance.now() - startedAt),
      });
    }
  }

  private async *run(
    request: ChatRequest,
    trace: TraceDraft,
    startedAt: number,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const { retrieve, llm } = this.deps;
    const elapsed = () => Math.round(performance.now() - startedAt);
    const usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
    const question = trace.question;
    const history = this.trimHistory(request.messages.slice(0, -1));

    // 1. Make follow-ups ("what about the second one?") searchable on their own.
    const { query, rewriteMs } = await this.rewrite(history, question, usage, signal);
    Object.assign(trace, { query, rewritten: query !== question, rewriteMs });

    // 2. Retrieve.
    const retrieval = await retrieve.execute(
      query,
      request.documentIds ? { documentIds: request.documentIds } : {},
    );
    const sources: SourceDto[] = retrieval.chunks.map((c, i) => ({
      n: i + 1,
      chunkId: c.chunkId,
      documentId: c.documentId,
      filename: c.filename,
      heading: c.heading,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      content: c.content,
      similarity: c.similarity,
      vectorRank: c.vectorRank,
      keywordRank: c.keywordRank,
    }));
    trace.retrievalMs = retrieval.stats.durationMs;
    trace.topSimilarity = retrieval.stats.topSimilarity;
    trace.sources = sources.map((s) => ({
      n: s.n,
      chunkId: s.chunkId,
      documentId: s.documentId,
      filename: s.filename,
      heading: s.heading,
      similarity: s.similarity,
      vectorRank: s.vectorRank,
      keywordRank: s.keywordRank,
      cited: false,
    }));

    yield {
      type: 'retrieval',
      query,
      rewritten: trace.rewritten,
      relevant: retrieval.relevant,
      sources,
      stats: {
        vectorHits: retrieval.stats.vectorHits,
        keywordHits: retrieval.stats.keywordHits,
        topSimilarity: retrieval.stats.topSimilarity,
      },
    };

    const timings = { rewriteMs, retrievalMs: retrieval.stats.durationMs };
    const done = (outcome: AnswerOutcome): ChatEvent => {
      Object.assign(trace, usage);
      trace.outcome = outcome;
      return {
        type: 'done',
        outcome,
        citations: trace.citations,
        invalidCitations: trace.invalidCitations,
        model: llm.modelId,
        requestId: trace.requestId,
        usage,
        timings: { ...timings, firstTokenMs: trace.firstTokenMs, totalMs: elapsed() },
      };
    };

    // 3. Relevance gate: don't spend an LLM call on an off-topic question.
    if (!retrieval.relevant) {
      trace.answer = NO_RELEVANT_SOURCES_ANSWER;
      yield { type: 'delta', text: NO_RELEVANT_SOURCES_ANSWER };
      yield done('no_relevant_sources');
      return;
    }

    // 4. Generate, streaming tokens through as they arrive.
    let stopReason: 'complete' | 'max_tokens' | 'refusal' = 'complete';
    try {
      for await (const event of llm.stream({
        system: ANSWER_SYSTEM_PROMPT,
        messages: buildAnswerMessages(history, question, sources),
        maxTokens: this.settings.maxTokens,
        ...(signal && { signal }),
      })) {
        if (event.type === 'text') {
          trace.firstTokenMs ??= elapsed();
          trace.answer += event.text;
          yield { type: 'delta', text: event.text };
        } else {
          usage.inputTokens += event.usage.inputTokens;
          usage.outputTokens += event.usage.outputTokens;
          stopReason = event.stopReason;
        }
      }
    } catch (err) {
      if (err instanceof LLMError) {
        Object.assign(trace, usage, { outcome: 'error', errorCode: err.code });
        yield { type: 'error', code: err.code, message: err.message };
        return;
      }
      throw err;
    }

    // 5. Check every [n] the model cited refers to a source it was given.
    const citations = extractCitations(trace.answer, sources.length);
    trace.citations = citations.valid;
    trace.invalidCitations = citations.invalid;
    for (const s of trace.sources) s.cited = citations.valid.includes(s.n);

    yield done(
      stopReason === 'refusal' ? 'refused' : stopReason === 'max_tokens' ? 'truncated' : 'answered',
    );
  }

  /** Recording a trace must never break or delay an answer that already succeeded. */
  private async save(trace: QueryTrace) {
    const { logger } = this.deps;
    logger.info(
      {
        requestId: trace.requestId,
        outcome: trace.outcome,
        errorCode: trace.errorCode,
        rewritten: trace.rewritten,
        sources: trace.sources.length,
        cited: trace.citations.length,
        invalidCitations: trace.invalidCitations.length,
        topSimilarity: trace.topSimilarity,
        inputTokens: trace.inputTokens,
        outputTokens: trace.outputTokens,
        rewriteMs: trace.rewriteMs,
        retrievalMs: trace.retrievalMs,
        firstTokenMs: trace.firstTokenMs,
        totalMs: trace.totalMs,
      },
      'question answered',
    );
    if (trace.invalidCitations.length > 0) {
      logger.warn(
        { requestId: trace.requestId, invalid: trace.invalidCitations },
        'answer cited unknown sources',
      );
    }
    try {
      await this.deps.traces.record(trace);
    } catch (err) {
      logger.error({ err, requestId: trace.requestId }, 'failed to record query trace');
    }
  }

  private trimHistory(messages: ChatRequest['messages']): ChatTurn[] {
    const keep = this.settings.historyTurns * 2; // a turn is a question and an answer
    return messages.slice(keep === 0 ? messages.length : -keep).map((m) => ({
      role: m.role,
      content: m.content.slice(0, MAX_HISTORY_MESSAGE_CHARS),
    }));
  }

  private async rewrite(
    history: ChatTurn[],
    question: string,
    usage: LLMUsage,
    signal?: AbortSignal,
  ): Promise<{ query: string; rewriteMs: number }> {
    if (history.length === 0) return { query: question, rewriteMs: 0 };
    const startedAt = performance.now();
    try {
      const result = await this.deps.llm.complete({
        system: REWRITE_SYSTEM_PROMPT,
        messages: buildRewriteMessages(history, question),
        maxTokens: 1024,
        ...(signal && { signal }),
      });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      const query = result.text.split('\n')[0]?.trim();
      return { query: query || question, rewriteMs: Math.round(performance.now() - startedAt) };
    } catch (err) {
      // Degrade gracefully: searching with the raw question is worse, not broken.
      this.deps.logger.warn({ err }, 'query rewrite failed; using the original question');
      return { query: question, rewriteMs: Math.round(performance.now() - startedAt) };
    }
  }
}
