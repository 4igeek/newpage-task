import { DomainError } from '../domain/errors.js';
import type { BlobStore, DocumentRecord, DocumentRepository, Logger } from '../ports/index.js';

/** Read and delete operations on the document library. */
export class DocumentLibrary {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly blobs: BlobStore,
    private readonly logger: Logger,
  ) {}

  list(): Promise<DocumentRecord[]> {
    return this.documents.list();
  }

  async get(id: string): Promise<DocumentRecord> {
    const doc = await this.documents.findById(id);
    if (!doc) throw new DomainError('NOT_FOUND', 'Document not found.');
    return doc;
  }

  async delete(id: string): Promise<void> {
    // Row first (chunks and jobs cascade), then blob. A failed blob delete
    // leaves an orphaned file, which is harmless and logged; the reverse order
    // could leave a searchable document whose source has gone.
    const deleted = await this.documents.delete(id);
    if (!deleted) throw new DomainError('NOT_FOUND', 'Document not found.');
    try {
      await this.blobs.delete(deleted.contentHash);
    } catch (err) {
      this.logger.warn({ err, documentId: id }, 'failed to delete blob; orphan left behind');
    }
  }
}
