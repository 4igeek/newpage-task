import type { DocumentDto } from '@docchat/shared';

export interface Scope {
  /** IDs to restrict search to, or undefined to search every ready document. */
  documentIds: string[] | undefined;
  /** How many documents will be searched. */
  count: number;
  /** How many ready documents exist. */
  total: number;
}

/**
 * Turns the user's selection into a search scope. An empty selection means
 * "everything". Stale IDs (a selected document that was since deleted, or is
 * not ready) are ignored, and if none of the selection is usable the scope
 * falls back to everything rather than silently searching nothing.
 */
export function resolveScope(selected: ReadonlySet<string>, documents: DocumentDto[]): Scope {
  const ready = documents.filter((d) => d.status === 'ready');
  const ids = ready.filter((d) => selected.has(d.id)).map((d) => d.id);
  return ids.length === 0 || ids.length === ready.length
    ? { documentIds: undefined, count: ready.length, total: ready.length }
    : { documentIds: ids, count: ids.length, total: ready.length };
}
