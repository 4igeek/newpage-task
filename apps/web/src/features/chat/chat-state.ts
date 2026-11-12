import type { ChatEvent, ChatMessage } from '@docchat/shared';

export type RetrievalEvent = Extract<ChatEvent, { type: 'retrieval' }>;
export type DoneEvent = Extract<ChatEvent, { type: 'done' }>;

export interface UserTurn {
  id: string;
  role: 'user';
  content: string;
}

export interface AssistantTurn {
  id: string;
  role: 'assistant';
  content: string;
  status: 'retrieving' | 'streaming' | 'done' | 'error' | 'stopped';
  /** Number of documents the search was limited to; undefined means all of them. */
  scopedTo?: number;
  retrieval?: RetrievalEvent;
  done?: DoneEvent;
  error?: { code: string; message: string };
}

export type Turn = UserTurn | AssistantTurn;

/** Pure reducer: folds one server event into the assistant turn being streamed. */
export function applyEvent(turn: AssistantTurn, event: ChatEvent): AssistantTurn {
  switch (event.type) {
    case 'retrieval':
      return { ...turn, retrieval: event, status: 'streaming' };
    case 'delta':
      return { ...turn, content: turn.content + event.text, status: 'streaming' };
    case 'done':
      return { ...turn, done: event, status: 'done' };
    case 'error':
      return { ...turn, error: { code: event.code, message: event.message }, status: 'error' };
  }
}

/**
 * The conversation to send with a new question. Only completed, real answers
 * are included as history: an errored, stopped or "nothing found" reply would
 * just add noise for the query rewriter and the model.
 */
export function toRequestMessages(turns: Turn[], question: string): ChatMessage[] {
  const history = turns.flatMap((t): ChatMessage[] => {
    if (t.role === 'user') return [{ role: 'user', content: t.content }];
    const usable = t.status === 'done' && t.done?.outcome === 'answered' && t.content.trim();
    return usable ? [{ role: 'assistant', content: t.content }] : [];
  });
  return [...history, { role: 'user', content: question }];
}

export const isBusy = (turns: Turn[]): boolean => {
  const last = turns.at(-1);
  return (
    last?.role === 'assistant' && (last.status === 'retrieving' || last.status === 'streaming')
  );
};
