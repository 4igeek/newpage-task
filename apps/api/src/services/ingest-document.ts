import { chunkSections } from '../domain/chunker.js';
import { PermanentIngestionError } from '../domain/errors.js';
import type {
  BlobStore,
  ChunkRepository,
  DocumentParser,
  DocumentRepository,
  Embedder,
  Logger,
} from '../ports/index.js';

const EMBED_BATCH_SIZE = 32;

export interface IngestionSettings {
  targetTokens: number;
  overlapTokens: number;
}

/**
 * The ingestion pipeline: blob -> parse -> chunk -> embed -> store.
 *
 * Idempotent by design: chunks are replaced atomically, so a retry after a
 * crash at any step produces the same end state with no duplicates.
 */
export class IngestDocument {
  constructor(
    private readonly deps: {
      documents: DocumentRepository;
      chunks: ChunkRepository;
      blobs: BlobStore;
      parser: DocumentParser;
      embedder: Embedder;
      logger: Logger;
    },
    private readonly settings: IngestionSettings,
  ) {}

  async execute(documentId: string): Promise<void> {
    const { documents, chunks, blobs, parser, embedder, logger } = this.deps;
    const startedAt = performance.now();

    const doc = await documents.findById(documentId);
    if (!doc) {
      logger.warn({ documentId }, 'document deleted before ingestion; skipping');
      return;
    }
    await documents.setStatus(doc.id, 'processing', { error: null });

    const bytes = await blobs.get(doc.contentHash);
    const parsed = await parser.parse(doc.mimeType, bytes);

    const drafts = chunkSections(parsed.sections, {
      ...this.settings,
      // Leave headroom for the contextual header and special tokens.
      maxTokens: embedder.maxTokens - 64,
      countTokens: (t) => embedder.countTokens(t),
    });
    if (drafts.length === 0) {
      throw new PermanentIngestionError(
        'NO_EXTRACTABLE_TEXT',
        'No text could be extracted. Scanned PDFs (images only) are not supported yet.',
      );
    }

    // Contextual chunk header: the embedding sees which document and section a
    // chunk belongs to, which a bare paragraph often doesn't say on its own.
    const embedInputs = drafts.map((d) =>
      [doc.filename, d.heading, d.content].filter(Boolean).join('\n'),
    );
    const embeddings: number[][] = [];
    for (let i = 0; i < embedInputs.length; i += EMBED_BATCH_SIZE) {
      embeddings.push(
        ...(await embedder.embed(embedInputs.slice(i, i + EMBED_BATCH_SIZE), 'document')),
      );
    }

    await chunks.replaceForDocument(
      doc.id,
      drafts.map((d, i) => ({ ...d, embedding: embeddings[i] ?? [] })),
    );
    await documents.setStatus(doc.id, 'ready', { pageCount: parsed.pageCount ?? null });

    logger.info(
      {
        documentId: doc.id,
        chunks: drafts.length,
        tokens: drafts.reduce((n, d) => n + d.tokenCount, 0),
        durationMs: Math.round(performance.now() - startedAt),
      },
      'document ingested',
    );
  }
}
