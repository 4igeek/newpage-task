import type { DoneEvent } from '../chat/chat-state';

export interface TimingSegment {
  label: string;
  ms: number;
}

/**
 * Splits an answer's total time into its stages. `firstTokenMs` is measured
 * from the start of the request, so the model's own time-to-first-token is
 * what's left after rewriting and retrieval.
 */
export function timingBreakdown(timings: DoneEvent['timings']): TimingSegment[] {
  const { rewriteMs, retrievalMs, firstTokenMs, totalMs } = timings;
  if (firstTokenMs === null) {
    return [
      { label: 'Rewrite', ms: rewriteMs },
      { label: 'Search', ms: retrievalMs },
    ].filter((s) => s.ms > 0);
  }
  return [
    { label: 'Rewrite', ms: rewriteMs },
    { label: 'Search', ms: retrievalMs },
    { label: 'Model thinking', ms: Math.max(0, firstTokenMs - rewriteMs - retrievalMs) },
    { label: 'Streaming', ms: Math.max(0, totalMs - firstTokenMs) },
  ].filter((s) => s.ms > 0);
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
