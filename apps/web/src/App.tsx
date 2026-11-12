import { useQuery } from '@tanstack/react-query';
import { MessagesSquare, PanelLeft } from 'lucide-react';
import { useState } from 'react';
import { DocumentLibrary } from './features/documents/DocumentLibrary';
import { api } from './lib/api';

export function App() {
  // On small screens the library is a slide-over drawer; on desktop it is a fixed column.
  const [libraryOpen, setLibraryOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <Header onToggleLibrary={() => setLibraryOpen((o) => !o)} />

      <div className="relative flex min-h-0 flex-1">
        {libraryOpen && (
          <button
            type="button"
            aria-label="Close documents"
            onClick={() => setLibraryOpen(false)}
            className="fixed inset-0 z-20 bg-stone-950/40 md:hidden"
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-80 max-w-[85vw] border-r border-stone-200 bg-white transition-transform md:static md:z-auto md:translate-x-0 dark:border-stone-800 dark:bg-stone-900 ${
            libraryOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <DocumentLibrary onClose={() => setLibraryOpen(false)} />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col items-center justify-center px-4 text-center">
          <MessagesSquare className="size-10 text-stone-300 dark:text-stone-700" aria-hidden />
          <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">Chat is coming next.</p>
        </main>
      </div>
    </div>
  );
}

function Header({ onToggleLibrary }: { onToggleLibrary: () => void }) {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 15_000 });
  const online = health.data?.status === 'ok';

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-4 dark:border-stone-800 dark:bg-stone-900">
      <button
        type="button"
        onClick={onToggleLibrary}
        aria-label="Show documents"
        className="-ml-1 rounded-md p-1.5 text-stone-600 hover:bg-stone-100 md:hidden dark:text-stone-300 dark:hover:bg-stone-800"
      >
        <PanelLeft className="size-5" />
      </button>
      <div className="flex items-center gap-2">
        <div className="grid size-7 place-items-center rounded-lg bg-teal-600 text-sm font-bold text-white">
          D
        </div>
        <h1 className="font-semibold tracking-tight">DocChat</h1>
      </div>
      <div
        className="ml-auto flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400"
        role="status"
      >
        <span
          className={`size-2 rounded-full ${
            health.isPending ? 'bg-stone-300' : online ? 'bg-emerald-500' : 'bg-red-500'
          }`}
          aria-hidden
        />
        {health.isPending ? 'Connecting…' : online ? 'Connected' : 'API unreachable'}
      </div>
    </header>
  );
}
