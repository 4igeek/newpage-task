import type { DocumentDto } from '@docchat/shared';
import { CircleAlert, FileText, LoaderCircle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { describeDocument } from '../../lib/format';
import { useDeleteDocument } from './use-documents';

export function DocumentItem({
  doc,
  selected,
  onToggle,
}: {
  doc: DocumentDto;
  selected: boolean;
  onToggle: () => void;
}) {
  const remove = useDeleteDocument();
  const [confirming, setConfirming] = useState(false);
  const inFlight = doc.status === 'pending' || doc.status === 'processing';

  return (
    <li
      className={`group relative flex items-start gap-3 rounded-lg px-2.5 py-2 ${
        selected
          ? 'bg-teal-50 dark:bg-teal-950/40'
          : 'hover:bg-stone-100 dark:hover:bg-stone-800/60'
      }`}
    >
      {/* Only ready documents can be searched, so only they can be selected. */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={doc.status !== 'ready'}
        aria-label={`Limit chat to ${doc.filename}`}
        className="mt-2.5 size-3.5 shrink-0 cursor-pointer accent-teal-600 disabled:cursor-not-allowed disabled:opacity-30"
      />
      <div
        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${
          doc.status === 'failed'
            ? 'bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400'
            : 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
        }`}
      >
        {inFlight ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : doc.status === 'failed' ? (
          <CircleAlert className="size-4" aria-hidden />
        ) : (
          <FileText className="size-4" aria-hidden />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-stone-900 dark:text-stone-100"
          title={doc.filename}
        >
          {doc.filename}
        </p>
        <p className="truncate text-xs text-stone-500 dark:text-stone-400">
          {inFlight ? (
            <span className="text-teal-700 dark:text-teal-400">
              {doc.status === 'pending' ? 'Queued…' : 'Reading and indexing…'}
            </span>
          ) : doc.status === 'failed' ? (
            <span className="text-red-600 dark:text-red-400" title={doc.error ?? undefined}>
              {doc.error ?? 'Processing failed'}
            </span>
          ) : (
            describeDocument(doc)
          )}
        </p>
      </div>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => remove.mutate(doc.id)}
            className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md px-2 py-1 text-xs text-stone-600 hover:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-700"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${doc.filename}`}
          className="shrink-0 rounded-md p-1.5 text-stone-400 opacity-0 transition hover:bg-stone-200 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-stone-700"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </li>
  );
}
