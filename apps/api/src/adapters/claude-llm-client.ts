import Anthropic from '@anthropic-ai/sdk';
import { LLMError } from '../domain/errors.js';
import type { LLMClient, LLMRequest, LLMStreamEvent, LLMUsage } from '../ports/index.js';

export type Effort = 'low' | 'medium' | 'high';

/**
 * Claude via the official SDK. The rest of the app only sees the LLMClient
 * port, so switching provider (or putting a gateway in front) means writing
 * one new adapter.
 *
 * - Effort is set explicitly: grounded Q&A over a handful of short chunks is
 *   not a hard reasoning task, so low effort keeps latency down.
 * - Server-side refusal fallback: if a safety classifier declines the request
 *   (e.g. a false positive on an uploaded document), the API re-runs it on a
 *   fallback model within the same call instead of failing the answer.
 * - The SDK retries 429/5xx/connection errors itself (maxRetries).
 */
export class ClaudeLLMClient implements LLMClient {
  private readonly client: Anthropic;

  constructor(
    readonly modelId: string,
    private readonly effort: Effort,
    apiKey: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async complete(request: LLMRequest): Promise<{ text: string; usage: LLMUsage }> {
    let text = '';
    let usage: LLMUsage = { inputTokens: 0, outputTokens: 0 };
    for await (const event of this.stream(request)) {
      if (event.type === 'text') text += event.text;
      else usage = event.usage;
    }
    return { text: text.trim(), usage };
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.modelId,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages,
          output_config: { effort: this.effort },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        { signal: request.signal },
      );

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();
      yield {
        type: 'end',
        usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
        stopReason:
          final.stop_reason === 'refusal'
            ? 'refusal'
            : final.stop_reason === 'max_tokens'
              ? 'max_tokens'
              : 'complete',
      };
    } catch (err) {
      throw toLLMError(err);
    }
  }
}

/** Translates SDK errors into domain errors; most specific class first. */
function toLLMError(err: unknown): unknown {
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return new LLMError('LLM_AUTH_FAILED', 'The language model rejected the API key.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new LLMError(
      'LLM_RATE_LIMITED',
      'The language model is rate limiting requests. Try again shortly.',
    );
  }
  if (err instanceof Anthropic.APIUserAbortError) return err; // client went away; not an error
  if (err instanceof Anthropic.APIError) {
    return new LLMError('LLM_UNAVAILABLE', 'The language model is unavailable right now.');
  }
  return err;
}

/** Used when no API key is configured: the app still runs, retrieval still works. */
export class UnconfiguredLLMClient implements LLMClient {
  readonly modelId = 'none';
  complete(): Promise<never> {
    throw new LLMError('LLM_NOT_CONFIGURED', 'Set ANTHROPIC_API_KEY to enable answers.');
  }
  // biome-ignore lint/correctness/useYield: always throws before yielding
  async *stream(): AsyncIterable<LLMStreamEvent> {
    throw new LLMError('LLM_NOT_CONFIGURED', 'Set ANTHROPIC_API_KEY to enable answers.');
  }
}
