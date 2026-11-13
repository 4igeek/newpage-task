import { FolderOpen, X } from 'lucide-react';
import { DocumentItem } from './DocumentItem';
import { resolveScope } from './scope';
import { UploadArea } from './UploadArea';
import { useDocuments } from './use-documents';

/**
 * The library, with selection: ticking documents limits the chat to them.
 * `onClose` is shown on small screens, where the library is a drawer.
 */
export function DocumentLibrary({
  selected,
  onToggle,
  onClearSelection,
  onClose,
}: {
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onClearSelection: () => void;
  onClose?: () => void;
}) {
  const documents = useDocuments();
  const docs = documents.data ?? [];
  const ready = docs.filter((d) => d.status === 'ready').length;
  const scope = resolveScope(selected, docs);

  return (
    <section aria-labelledby="library-heading" className="flex h-full flex-col">
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <h2
            id="library-heading"
            className="text-sm font-semibold text-stone-900 dark:text-stone-100"
          >
            Documents
          </h2>
          <div className="ml-auto flex items-center gap-1">
            {scope.documentIds ? (
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded px-1 text-xs text-teal-700 hover:underline dark:text-teal-400"
              >
                Clear selection
              </button>
            ) : (
              docs.length > 0 && (
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  {ready} of {docs.length} ready
                </span>
              )
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close documents"
                className="-mr-1 rounded-md p-1 text-stone-500 hover:bg-stone-100 md:hidden dark:hover:bg-stone-800"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        <UploadArea />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {documents.isPending ? (
          <ul className="space-y-2 px-2" aria-busy="true" aria-label="Loading documents">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="h-11 animate-pulse rounded-lg bg-stone-200/70 dark:bg-stone-800"
              />
            ))}
          </ul>
        ) : documents.isError ? (
          <p className="px-2 text-sm text-red-600 dark:text-red-400">
            Couldn't load documents. Is the API running?
          </p>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <FolderOpen className="size-8 text-stone-300 dark:text-stone-600" aria-hidden />
            <p className="text-sm text-stone-500 dark:text-stone-400">
              No documents yet. Upload some to start asking questions.
            </p>
          </div>
        ) : (
          <>
            {ready >= 2 && (
              <p className="px-2.5 pb-2 text-xs text-stone-500 dark:text-stone-400">
                {scope.documentIds
                  ? `Chat searches ${scope.count} of ${scope.total} documents.`
                  : 'Tick documents to limit the chat to them.'}
              </p>
            )}
            <ul aria-label="Uploaded documents" className="space-y-0.5">
              {docs.map((doc) => (
                <DocumentItem
                  key={doc.id}
                  doc={doc}
                  selected={selected.has(doc.id) && doc.status === 'ready'}
                  onToggle={() => onToggle(doc.id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
