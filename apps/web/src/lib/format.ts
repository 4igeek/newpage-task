import type { DocumentDto } from '@docchat/shared';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TYPE_LABELS: Record<DocumentDto['mimeType'], string> = {
  'application/pdf': 'PDF',
  'text/markdown': 'Markdown',
  'text/plain': 'Text',
};

/** One-line summary under a document's name, e.g. "PDF · 3 pages · 2 chunks · 3.2 KB". */
export function describeDocument(doc: DocumentDto): string {
  return [
    TYPE_LABELS[doc.mimeType],
    doc.pageCount ? plural(doc.pageCount, 'page') : null,
    doc.status === 'ready' ? plural(doc.chunkCount, 'chunk') : null,
    formatBytes(doc.sizeBytes),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Extensions the API accepts; used for the file picker's `accept` attribute. */
export const ACCEPTED_FILE_TYPES = '.pdf,.md,.markdown,.txt,.text';
