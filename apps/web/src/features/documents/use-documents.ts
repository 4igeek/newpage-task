import type { DocumentDto } from '@docchat/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

const DOCUMENTS_KEY = ['documents'] as const;
const POLL_WHILE_PROCESSING_MS = 1500;

const isInFlight = (doc: DocumentDto) => doc.status === 'pending' || doc.status === 'processing';

/**
 * The document library. Polls only while something is being processed, so an
 * idle page makes no requests. (Server-sent status events would replace this
 * polling at scale; for a handful of documents, polling is simpler.)
 */
export function useDocuments() {
  return useQuery({
    queryKey: DOCUMENTS_KEY,
    queryFn: api.listDocuments,
    refetchInterval: (query) =>
      query.state.data?.some(isInFlight) ? POLL_WHILE_PROCESSING_MS : false,
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.uploadDocument,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY }),
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.deleteDocument,
    // Remove it from the list straight away; the refetch confirms it.
    onMutate: (id) =>
      queryClient.setQueryData<DocumentDto[]>(DOCUMENTS_KEY, (docs) =>
        docs?.filter((d) => d.id !== id),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY }),
  });
}
