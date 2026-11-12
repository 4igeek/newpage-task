import { useCallback, useRef, useState } from 'react';
import { ApiRequestError, api } from '../../lib/api';
import { type AssistantTurn, applyEvent, isBusy, type Turn, toRequestMessages } from './chat-state';

/**
 * Conversation state lives in the browser; the API is stateless. Each
 * question sends the (trimmed) history, and the answer streams into the last
 * assistant turn.
 */
export function useChat(options: { documentIds?: string[] } = {}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const updateLast = useCallback((update: (turn: AssistantTurn) => AssistantTurn) => {
    setTurns((all) => {
      const last = all.at(-1);
      return last?.role === 'assistant' ? [...all.slice(0, -1), update(last)] : all;
    });
  }, []);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || isBusy(turns)) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setTurns((all) => [
        ...all,
        { id: crypto.randomUUID(), role: 'user', content: text },
        { id: crypto.randomUUID(), role: 'assistant', content: '', status: 'retrieving' },
      ]);

      try {
        const events = api.streamChat(
          {
            messages: toRequestMessages(turns, text),
            ...(options.documentIds && { documentIds: options.documentIds }),
          },
          controller.signal,
        );
        for await (const event of events) updateLast((turn) => applyEvent(turn, event));
        // A stream that ends without `done` or `error` was cut off.
        updateLast((turn) =>
          turn.status === 'streaming' || turn.status === 'retrieving'
            ? {
                ...turn,
                status: 'error',
                error: { code: 'INCOMPLETE', message: 'The answer was cut off.' },
              }
            : turn,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          updateLast((turn) => ({ ...turn, status: 'stopped' }));
          return;
        }
        const message =
          err instanceof ApiRequestError ? err.message : 'Could not reach the server. Try again.';
        const code = err instanceof ApiRequestError ? err.code : 'NETWORK_ERROR';
        updateLast((turn) => ({ ...turn, status: 'error', error: { code, message } }));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [turns, options.documentIds, updateLast],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
  }, []);

  return { turns, send, stop, reset, busy: isBusy(turns) };
}
