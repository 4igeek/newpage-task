import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 10_000 });

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">DocChat</h1>
        <p className="mt-2 text-slate-600">Ask questions about your documents.</p>
        <p className="mt-8 text-sm">
          API status:{' '}
          <span className="font-mono">
            {health.isPending ? 'checking…' : health.isError ? 'unreachable' : health.data.status}
          </span>
        </p>
      </div>
    </main>
  );
}
