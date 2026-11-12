import { createHash } from 'node:crypto';
import { DomainError } from '../domain/errors.js';
import { detectMimeType } from '../domain/file-types.js';
import type { BlobStore, DocumentRecord, DocumentRepository } from '../ports/index.js';

export interface UploadInput {
  filename: string;
  bytes: Buffer;
}

/**
 * Accepts a file, stores it, and queues it for ingestion. Returns quickly:
 * parsing and embedding happen in the worker, so a large PDF never blocks
 * an HTTP request.
 *
 * Uploads are idempotent: the blob key and the dedup key are both the sha256
 * of the content, so uploading the same file twice returns the original.
 */
export class UploadDocument {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly blobs: BlobStore,
  ) {}

  async execute({
    filename,
    bytes,
  }: UploadInput): Promise<{ document: DocumentRecord; created: boolean }> {
    if (bytes.length === 0) throw new DomainError('EMPTY_FILE', 'The uploaded file is empty.');

    const mimeType = detectMimeType(filename, bytes);
    if (!mimeType) {
      throw new DomainError(
        'UNSUPPORTED_FILE_TYPE',
        'Only PDF, Markdown (.md) and text (.txt) files are supported.',
      );
    }

    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const existing = await this.documents.findByHash(contentHash);
    if (existing) return { document: existing, created: false };

    // Blob first, then row: if the insert fails we leave an unreferenced blob
    // (harmless, and overwritten by an identical retry). The reverse order could
    // leave a row pointing at a missing blob.
    await this.blobs.put(contentHash, bytes);
    return this.documents.createWithIngestJob({
      filename: sanitizeFilename(filename),
      mimeType,
      sizeBytes: bytes.length,
      contentHash,
    });
  }
}

/** Display-only name: strip any path and control characters. Never used to build a file path. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'untitled';
  return base.replace(/[\p{Cc}]/gu, '').slice(0, 255) || 'untitled';
}
