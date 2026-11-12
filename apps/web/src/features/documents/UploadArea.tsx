import { CircleAlert, Info, Upload, X } from 'lucide-react';
import { type DragEvent, useId, useRef, useState } from 'react';
import { ApiRequestError } from '../../lib/api';
import { ACCEPTED_FILE_TYPES } from '../../lib/format';
import { useUploadDocument } from './use-documents';

interface Notice {
  id: string;
  kind: 'error' | 'info';
  text: string;
}

/**
 * Drop zone + file picker. Several files can be dropped at once; each is
 * uploaded independently, so one bad file doesn't block the others.
 */
export function UploadArea() {
  const upload = useUploadDocument();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);

  const notify = (kind: Notice['kind'], text: string) => {
    const id = crypto.randomUUID();
    setNotices((n) => [...n, { id, kind, text }]);
    if (kind === 'info') setTimeout(() => dismiss(id), 5000);
  };
  const dismiss = (id: string) => setNotices((n) => n.filter((x) => x.id !== id));

  async function uploadAll(files: File[]) {
    setPending((n) => n + files.length);
    await Promise.all(
      files.map(async (file) => {
        try {
          const result = await upload.mutateAsync(file);
          if (!result.created) {
            notify('info', `${file.name} is already in your library.`);
          }
        } catch (err) {
          const reason = err instanceof ApiRequestError ? err.message : 'Upload failed.';
          notify('error', `${file.name}: ${reason}`);
        } finally {
          setPending((n) => n - 1);
        }
      }),
    );
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void uploadAll([...e.dataTransfer.files]);
  };

  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors focus-within:ring-2 focus-within:ring-teal-500 ${
          dragging
            ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40'
            : 'border-stone-300 hover:border-teal-400 hover:bg-stone-100/60 dark:border-stone-700 dark:hover:bg-stone-800/50'
        }`}
      >
        <Upload className="size-5 text-teal-600 dark:text-teal-400" aria-hidden />
        <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
          {pending > 0 ? `Uploading ${pending}…` : 'Drop files or click to upload'}
        </span>
        <span className="text-xs text-stone-500 dark:text-stone-400">PDF, Markdown or text</span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPTED_FILE_TYPES}
          className="sr-only"
          onChange={(e) => {
            void uploadAll([...(e.target.files ?? [])]);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
      </label>

      <ul aria-live="polite" className="space-y-1.5">
        {notices.map((n) => (
          <li
            key={n.id}
            className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
              n.kind === 'error'
                ? 'bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-200'
                : 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
            }`}
          >
            {n.kind === 'error' ? (
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
            ) : (
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            )}
            <span className="min-w-0 flex-1 break-words">{n.text}</span>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              className="shrink-0 rounded opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
