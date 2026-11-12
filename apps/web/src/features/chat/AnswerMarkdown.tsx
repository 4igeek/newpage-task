import type { SourceDto } from '@docchat/shared';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sourceLabel } from './source-label';

/** Turns "[2]" into a link "#cite-2" so the Markdown renderer hands it to us. */
const linkCitations = (text: string) => text.replace(/\[(\d+)\](?!\()/g, '[$1](#cite-$1)');

/**
 * Renders an answer. react-markdown never renders raw HTML, so text that came
 * from an uploaded document can't inject markup through the model's answer.
 */
export function AnswerMarkdown({
  text,
  sources,
  onCite,
}: {
  text: string;
  sources: SourceDto[];
  onCite?: (n: number) => void;
}) {
  return (
    <div className="prose prose-sm prose-stone max-w-none dark:prose-invert prose-p:my-2 prose-li:my-0.5 prose-ul:my-2 prose-ol:my-2">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const n = href?.startsWith('#cite-') ? Number(href.slice(6)) : null;
            if (n === null) {
              return (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              );
            }
            const source = sources.find((s) => s.n === n);
            return <CitationChip n={n} source={source} onClick={() => onCite?.(n)} />;
          },
        }}
      >
        {linkCitations(text)}
      </Markdown>
    </div>
  );
}

function CitationChip({
  n,
  source,
  onClick,
}: {
  n: number;
  source: SourceDto | undefined;
  onClick: () => void;
}) {
  if (!source) {
    // The model cited a number it wasn't given. Show it, but don't pretend it's a source.
    return (
      <span
        className="text-xs text-stone-400 line-through"
        title="Not one of the retrieved sources"
      >
        [{n}]
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={sourceLabel(source)}
      aria-label={`Source ${n}: ${sourceLabel(source)}`}
      className="mx-0.5 inline-grid h-[1.15rem] min-w-[1.15rem] -translate-y-px place-items-center rounded-md bg-teal-100 px-1 align-middle text-[0.68rem] font-semibold text-teal-800 no-underline transition hover:bg-teal-600 hover:text-white dark:bg-teal-900/70 dark:text-teal-200 dark:hover:bg-teal-500 dark:hover:text-stone-950"
    >
      {n}
    </button>
  );
}
