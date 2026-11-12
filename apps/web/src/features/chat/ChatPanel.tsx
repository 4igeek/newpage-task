import type { DocumentDto } from '@docchat/shared';
import { Filter, MessagesSquare, SquarePen, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveScope } from '../documents/scope';
import { useDocuments } from '../documents/use-documents';
import { InspectPanel } from '../inspect/InspectPanel';
import { AssistantMessage } from './AssistantMessage';
import { Composer } from './Composer';
import type { AssistantTurn } from './chat-state';
import { useChat } from './use-chat';

export function ChatPanel({
  selected,
  onClearSelection,
}: {
  /** Documents ticked in the library; empty means search everything. */
  selected: ReadonlySet<string>;
  onClearSelection: () => void;
}) {
  const documents = useDocuments();
  const scope = resolveScope(selected, documents.data ?? []);
  const chat = useChat(scope.documentIds ? { documentIds: scope.documentIds } : {});
  // Store the turn's id, not the turn: it keeps updating while it streams.
  const [inspecting, setInspecting] = useState<{ turnId: string; n: number } | null>(null);
  const inspectedTurn = chat.turns.find(
    (t): t is AssistantTurn => t.role === 'assistant' && t.id === inspecting?.turnId,
  );
  const openSource = useCallback(
    (turn: AssistantTurn, n: number) => setInspecting({ turnId: turn.id, n }),
    [],
  );
  const closeInspector = useCallback(() => setInspecting(null), []);
  const selectSource = useCallback(
    (n: number) => setInspecting((current) => (current ? { ...current, n } : current)),
    [],
  );
  const ready = (documents.data ?? []).filter((d) => d.status === 'ready');
  const inScope = scope.documentIds
    ? ready.filter((d) => scope.documentIds?.includes(d.id))
    : ready;
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  // Follow the streaming answer, unless the user has scrolled up to read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run whenever the turns change
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [chat.turns]);

  const noDocuments = documents.isSuccess && ready.length === 0;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {chat.turns.length > 0 && (
          <div className="flex justify-end px-4 pt-3">
            <button
              type="button"
              onClick={() => {
                chat.reset();
                setInspecting(null);
              }}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800"
            >
              <SquarePen className="size-3.5" aria-hidden /> New chat
            </button>
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {chat.turns.length === 0 ? (
              <Welcome documents={inScope} onAsk={chat.send} noDocuments={noDocuments} />
            ) : (
              <ol className="space-y-8" aria-live="polite">
                {chat.turns.map((turn) => (
                  <li key={turn.id}>
                    {turn.role === 'user' ? (
                      <div className="flex justify-end">
                        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-teal-600 px-4 py-2.5 text-sm whitespace-pre-wrap text-white">
                          {turn.content}
                        </p>
                      </div>
                    ) : (
                      <AssistantMessage
                        turn={turn}
                        onOpenSource={openSource}
                        activeSource={inspecting?.turnId === turn.id ? inspecting.n : null}
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          {scope.documentIds && (
            <div className="mb-2 flex justify-center">
              <div
                className="flex max-w-full items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 py-1 pr-1 pl-2.5 text-xs text-teal-800 dark:border-teal-900 dark:bg-teal-950/50 dark:text-teal-200"
                title={inScope.map((d) => d.filename).join(', ')}
              >
                <Filter className="size-3 shrink-0" aria-hidden />
                <span className="truncate">
                  {scope.count === 1
                    ? `Searching only ${inScope[0]?.filename}`
                    : `Searching ${scope.count} of ${scope.total} documents`}
                </span>
                <button
                  type="button"
                  onClick={onClearSelection}
                  aria-label="Search all documents"
                  className="rounded-full p-0.5 hover:bg-teal-100 dark:hover:bg-teal-900"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          )}
          <Composer
            busy={chat.busy}
            disabled={noDocuments}
            placeholder={noDocuments ? 'Upload a document to start…' : 'Ask about your documents…'}
            onSend={chat.send}
            onStop={chat.stop}
          />
          <p className="mt-2 text-center text-[0.7rem] text-stone-400 dark:text-stone-500">
            Answers come only from your documents. Check the cited sources.
          </p>
        </div>
      </div>

      {inspecting && inspectedTurn && (
        <InspectPanel
          turn={inspectedTurn}
          n={inspecting.n}
          onSelect={selectSource}
          onClose={closeInspector}
        />
      )}
    </div>
  );
}

function Welcome({
  documents,
  noDocuments,
  onAsk,
}: {
  documents: DocumentDto[];
  noDocuments: boolean;
  onAsk: (q: string) => void;
}) {
  // Suggestions built from the actual library, so they always have an answer.
  const suggestions = documents.slice(0, 3).map((d) => `What is ${d.filename} about?`);

  return (
    <div className="flex flex-col items-center pt-[12vh] text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
        <MessagesSquare className="size-6" aria-hidden />
      </div>
      <h2 className="mt-4 text-lg font-semibold tracking-tight">Ask your documents</h2>
      <p className="mt-1 max-w-sm text-sm text-stone-500 dark:text-stone-400">
        {noDocuments
          ? 'Upload a PDF, Markdown or text file on the left, then ask anything about it.'
          : 'Every answer is grounded in your files and cites the passages it used.'}
      </p>
      {suggestions.length > 0 && (
        <ul className="mt-6 flex w-full max-w-md flex-col gap-2">
          {suggestions.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => onAsk(q)}
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-left text-sm text-stone-700 transition hover:border-teal-500 hover:text-teal-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300 dark:hover:text-teal-300"
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
