import type { SourceDto } from '@docchat/shared';
import { ChevronLeft, ChevronRight, FileText, X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { plural } from '../../lib/format';
import type { AssistantTurn } from '../chat/chat-state';
import { pagesLabel } from '../chat/source-label';
import { highlight } from './highlight';
import { formatMs, timingBreakdown } from './timings';

const TIMING_COLOURS = ['bg-amber-400', 'bg-sky-500', 'bg-violet-500', 'bg-teal-500'];

/**
 * "Show your work": the full passage behind a citation, why retrieval picked
 * it, and how the whole answer was produced. Doubles as a debugging tool for
 * retrieval quality.
 */
export function InspectPanel({
  turn,
  n,
  onSelect,
  onClose,
}: {
  turn: AssistantTurn;
  n: number;
  onSelect: (n: number) => void;
  onClose: () => void;
}) {
  const sources = turn.retrieval?.sources ?? [];
  const source = sources.find((s) => s.n === n) ?? sources[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && n > 1) onSelect(n - 1);
      if (e.key === 'ArrowRight' && n < sources.length) onSelect(n + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, sources.length, onSelect, onClose]);

  return (
    <aside
      aria-label="Source inspector"
      className="fixed inset-0 z-40 flex flex-col bg-white lg:static lg:z-auto lg:w-[26rem] lg:shrink-0 lg:border-l lg:border-stone-200 dark:bg-stone-900 lg:dark:border-stone-800"
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-stone-200 px-3 dark:border-stone-800">
        <h2 className="text-sm font-semibold">Inspect</h2>
        {sources.length > 0 && (
          <div className="ml-auto flex items-center gap-0.5 text-xs text-stone-500 dark:text-stone-400">
            <IconButton label="Previous source" disabled={n <= 1} onClick={() => onSelect(n - 1)}>
              <ChevronLeft className="size-4" />
            </IconButton>
            <span className="w-20 text-center tabular-nums">
              Source {source?.n} of {sources.length}
            </span>
            <IconButton
              label="Next source"
              disabled={n >= sources.length}
              onClick={() => onSelect(n + 1)}
            >
              <ChevronRight className="size-4" />
            </IconButton>
          </div>
        )}
        <IconButton
          label="Close inspector"
          onClick={onClose}
          className={sources.length ? 'ml-1' : 'ml-auto'}
        >
          <X className="size-4" />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {source ? (
          <>
            <Passage source={source} query={turn.retrieval?.query ?? ''} />
            <WhyRetrieved
              source={source}
              total={sources.length}
              cited={turn.done ? turn.done.citations.includes(source.n) : null}
            />
          </>
        ) : (
          <p className="text-sm text-stone-500">No sources were retrieved for this question.</p>
        )}
        <HowAnswered turn={turn} />
      </div>
    </aside>
  );
}

function Passage({ source, query }: { source: SourceDto; query: string }) {
  const pages = pagesLabel(source);
  return (
    <section>
      <div className="flex items-start gap-2.5">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
          <FileText className="size-4" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{source.filename}</p>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {[source.heading?.replaceAll(' > ', ' › '), pages].filter(Boolean).join(' · ') ||
              'Whole document'}
          </p>
        </div>
      </div>
      <blockquote className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm leading-relaxed whitespace-pre-wrap text-stone-700 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
        {highlight(source.content, query).map((seg) =>
          seg.match ? (
            <mark
              key={seg.offset}
              className="rounded-sm bg-amber-200/70 px-px text-inherit dark:bg-amber-500/30"
            >
              {seg.text}
            </mark>
          ) : (
            <span key={seg.offset}>{seg.text}</span>
          ),
        )}
      </blockquote>
      <p className="mt-1.5 text-[0.7rem] text-stone-400 dark:text-stone-500">
        Highlighted: words from the search query.
      </p>
    </section>
  );
}

function WhyRetrieved({
  source,
  total,
  cited,
}: {
  source: SourceDto;
  total: number;
  cited: boolean | null;
}) {
  const similarity = source.similarity;
  return (
    <section>
      <SectionTitle>Why this was retrieved</SectionTitle>
      <dl className="mt-2 space-y-2.5 text-sm">
        <Row label="Semantic similarity">
          {similarity === null ? (
            <span className="text-stone-400">not in top vector results</span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <span
                  className="block h-full rounded-full bg-teal-500"
                  style={{ width: `${Math.round(similarity * 100)}%` }}
                />
              </span>
              <span className="tabular-nums">{similarity.toFixed(3)}</span>
            </span>
          )}
        </Row>
        <Row label="Vector search rank">{rankLabel(source.vectorRank)}</Row>
        <Row label="Keyword search rank">{rankLabel(source.keywordRank, 'no keyword match')}</Row>
        <Row label="After fusion">
          #{source.n} of {total} sent to the model
        </Row>
        {cited !== null && (
          <Row label="Cited in answer">
            {cited ? (
              <span className="text-teal-700 dark:text-teal-400">Yes</span>
            ) : (
              <span className="text-stone-400">No</span>
            )}
          </Row>
        )}
      </dl>
    </section>
  );
}

function HowAnswered({ turn }: { turn: AssistantTurn }) {
  const retrieval = turn.retrieval;
  const done = turn.done;
  if (!retrieval) return null;
  const segments = done ? timingBreakdown(done.timings) : [];
  const total = segments.reduce((sum, s) => sum + s.ms, 0);

  return (
    <section>
      <SectionTitle>How this answer was made</SectionTitle>
      <dl className="mt-2 space-y-2.5 text-sm">
        <Row label={retrieval.rewritten ? 'Rewritten query' : 'Search query'}>
          <span className="italic">“{retrieval.query}”</span>
        </Row>
        <Row label="Candidates">
          {plural(retrieval.stats.vectorHits, 'vector hit')},{' '}
          {plural(retrieval.stats.keywordHits, 'keyword hit')}
        </Row>
        <Row label="Relevance gate">
          {retrieval.relevant ? 'passed' : 'blocked: nothing similar enough'}
          {retrieval.stats.topSimilarity !== null && (
            <span className="text-stone-400">
              {' '}
              (best {retrieval.stats.topSimilarity.toFixed(3)})
            </span>
          )}
        </Row>
        {done?.outcome === 'no_relevant_sources' && (
          <Row label="Model">
            <span className="text-stone-400">not called, to save cost and avoid a guess</span>
          </Row>
        )}
        {done && done.outcome !== 'no_relevant_sources' && (
          <>
            <Row label="Model">
              <code className="text-xs">{done.model}</code>
            </Row>
            <Row label="Tokens">
              {done.usage.inputTokens.toLocaleString()} in ·{' '}
              {done.usage.outputTokens.toLocaleString()} out
            </Row>
            {done.invalidCitations.length > 0 && (
              <Row label="Invalid citations">
                <span className="text-red-600 dark:text-red-400">
                  {done.invalidCitations.join(', ')}
                </span>
              </Row>
            )}
          </>
        )}
      </dl>

      {total > 0 && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-stone-500 dark:text-stone-400">Timing</span>
            <span className="font-medium tabular-nums">
              {formatMs(done?.timings.totalMs ?? total)}
            </span>
          </div>
          <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
            {segments.map((s, i) => (
              <span
                key={s.label}
                className={TIMING_COLOURS[i % TIMING_COLOURS.length]}
                style={{ width: `${(s.ms / total) * 100}%` }}
                title={`${s.label}: ${formatMs(s.ms)}`}
              />
            ))}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-stone-600 dark:text-stone-400">
            {segments.map((s, i) => (
              <li key={s.label} className="flex items-center gap-1.5">
                <span
                  className={`size-2 rounded-full ${TIMING_COLOURS[i % TIMING_COLOURS.length]}`}
                />
                {s.label}
                <span className="ml-auto tabular-nums">{formatMs(s.ms)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function rankLabel(rank: number | null, missing = 'not in top results') {
  return rank === null ? <span className="text-stone-400">{missing}</span> : `#${rank}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-baseline gap-3">
      <dt className="text-xs text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[0.7rem] font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
      {children}
    </h3>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  className = '',
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-stone-800 ${className}`}
    >
      {children}
    </button>
  );
}
