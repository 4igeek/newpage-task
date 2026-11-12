import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { chunks } from '../db/schema.js';
import type { ChunkRepository, ChunkToStore } from '../ports/index.js';

const INSERT_BATCH_SIZE = 200;

export class PgChunkRepository implements ChunkRepository {
  constructor(private readonly db: Database) {}

  async replaceForDocument(documentId: string, drafts: ChunkToStore[]) {
    await this.db.transaction(async (tx) => {
      await tx.delete(chunks).where(eq(chunks.documentId, documentId));
      for (let i = 0; i < drafts.length; i += INSERT_BATCH_SIZE) {
        await tx.insert(chunks).values(
          drafts.slice(i, i + INSERT_BATCH_SIZE).map((d) => ({
            documentId,
            ordinal: d.ordinal,
            content: d.content,
            heading: d.heading ?? null,
            pageStart: d.pageStart ?? null,
            pageEnd: d.pageEnd ?? null,
            tokenCount: d.tokenCount,
            embedding: d.embedding,
          })),
        );
      }
    });
  }
}
