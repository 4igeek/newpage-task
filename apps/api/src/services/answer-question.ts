import type { ChatEvent, ChatRequest, SourceDto } from '@docchat/shared';
import { LLMError } from '../domain/errors.js';
import {
  ANSWER_SYSTEM_PROMPT,
  buildAnswerMessages,
  buildRewriteMessages,
  type ChatTurn,
  extractCitations,
  REWRITE_SYSTEM_PROMPT,
} from '../domain/prompt.js';
import type { LLMClient, LLMUsage, Logger } from '../ports/index.js';
import type { Retrieve } from './retrieve.js';

export const NO_RELEVANT_SOURCES_ANSWER =
  "I couldn't find anything about that in your documents. Try rephrasing, or upload a document that covers it.";

/** Each history message is capped so one huge paste can't crowd out the sources. */
const MAX_HISTORY_MESSAGE_CHARS = 2000;

export interface AnswerSettings {
  historyTurns: number;
  maxTokens: number;
}

/**
 * The question-answering pipeline, as a stream of events:
 *
 *   rewrite follow-up -> retrieve -> [relevance gate] -> generate -> validate citations
 *
 * Emits `retrieval` before generation starts, so the UI can show sources
 * while the answer is still streaming.
 */
export class AnswerQuestion {
  constructor(
    private readonly deps: { retrieve: Pick<Retrieve, 'execute'>; llm: LLMClient; logger: Logger },
    private readonly settings: AnswerSettings,
  ) {}

  async *execute(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    const { retrieve, llm, logger } = this.deps;
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);
    const usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };

    const question = request.messages.at(-1)?.content ?? '';
    const history = this.trimHistory(request.messages.slice(0, -1));

    // 1. Make follow-ups ("what about the second one?") searchable on their own.
    const { query, rewriteMs } = await this.rewrite(history, question, usage, signal);

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
    yield {
      type: 'retrieval',
      query,
      rewritten: query !== question,
      relevant: retrieval.relevant,
      sources,
      stats: {
        vectorHits: retrieval.stats.vectorHits,
        keywordHits: retrieval.stats.keywordHits,
        topSimilarity: retrieval.stats.topSimilarity,
      },
    };

    const timings = { rewriteMs, retrievalMs: retrieval.stats.durationMs };

    // 3. Relevance gate: don't spend an LLM call on an off-topic question.
    if (!retrieval.relevant) {
      yield { type: 'delta', text: NO_RELEVANT_SOURCES_ANSWER };
      yield {
        type: 'done',
        outcome: 'no_relevant_sources',
        citations: [],
        invalidCitations: [],
        model: llm.modelId,
        usage,
        timings: { ...timings, firstTokenMs: null, totalMs: elapsed() },
      };
      logger.info({ query, outcome: 'no_relevant_sources', ...timings }, 'question answered');
      return;
    }

    // 4. Generate, streaming tokens through as they arrive.
    let answer = '';
    let firstTokenMs: number | null = null;
    let stopReason: 'complete' | 'max_tokens' | 'refusal' = 'complete';
    try {
      for await (const event of llm.stream({
        system: ANSWER_SYSTEM_PROMPT,
        messages: buildAnswerMessages(history, question, sources),
        maxTokens: this.settings.maxTokens,
        ...(signal && { signal }),
      })) {
        if (event.type === 'text') {
          firstTokenMs ??= elapsed();
          answer += event.text;
          yield { type: 'delta', text: event.text };
        } else {
          usage.inputTokens += event.usage.inputTokens;
          usage.outputTokens += event.usage.outputTokens;
          stopReason = event.stopReason;
        }
      }
    } catch (err) {
      if (err instanceof LLMError) {
        logger.warn({ code: err.code }, 'answer generation failed');
        yield { type: 'error', code: err.code, message: err.message };
        return;
      }
      throw err;
    }

    // 5. Check every [n] the model cited refers to a source it was given.
    const citations = extractCitations(answer, sources.length);
    if (citations.invalid.length > 0) {
      logger.warn(
        { invalid: citations.invalid, sources: sources.length },
        'answer cited unknown sources',
      );
    }

    const outcome =
      stopReason === 'refusal' ? 'refused' : stopReason === 'max_tokens' ? 'truncated' : 'answered';
    const totalMs = elapsed();
    yield {
      type: 'done',
      outcome,
      citations: citations.valid,
      invalidCitations: citations.invalid,
      model: llm.modelId,
      usage,
      timings: { ...timings, firstTokenMs, totalMs },
    };
    logger.info(
      {
        query,
        rewritten: query !== question,
        outcome,
        sources: sources.length,
        cited: citations.valid.length,
        invalidCitations: citations.invalid.length,
        topSimilarity: retrieval.stats.topSimilarity,
        ...usage,
        ...timings,
        firstTokenMs,
        totalMs,
      },
      'question answered',
    );
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
