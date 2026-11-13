import type { SourceDto } from '@docchat/shared';
import { CircleAlert, FileSearch, KeyRound, Square } from 'lucide-react';
import { plural } from '../../lib/format';
import { AnswerMarkdown } from './AnswerMarkdown';
import type { AssistantTurn } from './chat-state';
import { sectionName } from './source-label';

export function AssistantMessage({
  turn,
  onOpenSource,
  activeSource = null,
}: {
  turn: AssistantTurn;
  onOpenSource?: (turn: AssistantTurn, n: number) => void;
  /** The source currently open in the inspector, if it belongs to this answer. */
  activeSource?: number | null;
}) {
  const sources = turn.retrieval?.sources ?? [];
  const cited = new Set(turn.done?.citations ?? []);
  const notFound = turn.done?.outcome === 'no_relevant_sources';
  const open = (n: number) => onOpenSource?.(turn, n);

  return (
    <article
      className="space-y-3"
      aria-busy={turn.status === 'retrieving' || turn.status === 'streaming'}
    >
      {turn.status === 'retrieving' && (
        <p className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
          <FileSearch className="size-4 animate-pulse text-teal-600" aria-hidden />
          Searching your documents…
        </p>
      )}

      {turn.retrieval?.rewritten && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Searched for <span className="italic">“{turn.retrieval.query}”</span>
        </p>
      )}

      {turn.content && (
        <div className={notFound ? 'text-stone-500 italic dark:text-stone-400' : ''}>
          <AnswerMarkdown text={turn.content} sources={sources} onCite={open} />
          {turn.status === 'streaming' && (
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-teal-600 align-text-bottom" />
          )}
        </div>
      )}

      {turn.status === 'stopped' && (
        <p className="flex items-center gap-1.5 text-xs text-stone-500">
          <Square className="size-3" aria-hidden /> Stopped
        </p>
      )}

      {turn.error && (
        <ErrorNotice
          code={turn.error.code}
          message={turn.error.message}
          hasSources={sources.length > 0}
        />
      )}

      {sources.length > 0 && !notFound && (
        <SourceList
          sources={sources}
          cited={cited}
          done={turn.status === 'done'}
          active={activeSource}
          onOpen={open}
        />
      )}

      {turn.done && (
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-stone-400 dark:text-stone-500">
          {(turn.done.timings.totalMs / 1000).toFixed(1)}s ·{' '}
          {notFound
            ? 'no model call'
            : plural(turn.done.usage.inputTokens + turn.done.usage.outputTokens, 'token')}
          {turn.done.outcome === 'truncated' && ' · answer was cut short'}
          {turn.done.outcome === 'refused' && ' · the model declined to answer'}
          {onOpenSource && (
            <>
              {' · '}
              <button
                type="button"
                onClick={() => open(turn.done?.citations[0] ?? 1)}
                className="rounded text-teal-700 underline-offset-2 hover:underline dark:text-teal-400"
              >
                Inspect
              </button>
            </>
          )}
        </p>
      )}
    </article>
  );
}

function SourceList({
  sources,
  cited,
  done,
  active,
  onOpen,
}: {
  sources: SourceDto[];
  cited: Set<number>;
  done: boolean;
  active: number | null;
  onOpen: (n: number) => void;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[0.7rem] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
        Sources
      </h3>
      <ul aria-label="Sources" className="flex flex-wrap gap-1.5">
        {sources.map((s) => {
          // Until the answer is complete we don't know which sources were cited.
          const dim = done && !cited.has(s.n);
          return (
            <li key={s.chunkId}>
              <button
                type="button"
                onClick={() => onOpen(s.n)}
                aria-pressed={active === s.n}
                title={dim ? 'Retrieved but not cited in the answer' : undefined}
                className={`flex max-w-64 items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-xs transition hover:border-teal-500 aria-pressed:border-teal-500 aria-pressed:ring-2 aria-pressed:ring-teal-500/20 ${
                  dim
                    ? 'border-stone-200 text-stone-400 dark:border-stone-800 dark:text-stone-500'
                    : 'border-stone-300 bg-white text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300'
                }`}
              >
                <span
                  className={`grid size-4 shrink-0 place-items-center rounded text-[0.65rem] font-semibold ${
                    dim
                      ? 'bg-stone-100 dark:bg-stone-800'
                      : 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200'
                  }`}
                >
                  {s.n}
                </span>
                <span className="truncate">
                  {s.filename}
                  {sectionName(s.heading) && (
                    <span className="text-stone-400 dark:text-stone-500">
                      {' '}
                      · {sectionName(s.heading)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ErrorNotice({
  code,
  message,
  hasSources,
}: {
  code: string;
  message: string;
  hasSources: boolean;
}) {
  if (code === 'LLM_NOT_CONFIGURED') {
    return (
      <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">Answers are turned off</p>
          <p className="mt-0.5 text-amber-800 dark:text-amber-300/80">
            No <code className="text-xs">ANTHROPIC_API_KEY</code> is set.
            {hasSources &&
              ' Retrieval still works: these are the sources that would be sent to the model.'}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  );
}
