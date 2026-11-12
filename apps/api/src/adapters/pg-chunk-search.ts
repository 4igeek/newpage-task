import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { chunks, documents } from '../db/schema.js';
import type { ChunkHit, ChunkSearch, SearchFilter } from '../ports/index.js';

/**
 * Both searches run in Postgres. Only chunks of `ready` documents are
 * searchable, and an optional filter scopes the search to chosen documents.
 */
export class PgChunkSearch implements ChunkSearch {
  constructor(private readonly db: Database) {}

  async vectorSearch(embedding: number[], limit: number, filter?: SearchFilter) {
    // <=> is pgvector's cosine distance; ordering by it uses the HNSW index.
    const distance = sql<number>`${chunks.embedding} <=> ${JSON.stringify(embedding)}::vector`;
    return this.search(sql<number>`1 - (${distance})`, distance, limit, filter);
  }

  async keywordSearch(query: string, limit: number, filter?: SearchFilter) {
    // plainto_tsquery stems words and drops stop words, but ANDs the terms, so a
    // natural-language question rarely matches anything. Rewriting & to | ORs
    // them; ts_rank_cd still ranks chunks matching more terms (closer together) higher.
    const tsquery = sql`replace(plainto_tsquery('english', ${query})::text, '&', '|')::tsquery`;
    const rank = sql<number>`ts_rank_cd(${chunks.contentTsv}, ${tsquery})`;
    return this.search(rank, desc(rank), limit, filter, sql`${chunks.contentTsv} @@ ${tsquery}`);
  }

  private async search(
    score: SQL<number>,
    orderBy: SQL,
    limit: number,
    filter: SearchFilter | undefined,
    match?: SQL,
  ): Promise<ChunkHit[]> {
    if (filter?.documentIds?.length === 0) return [];
    return this.db
      .select({
        chunkId: chunks.id,
        documentId: chunks.documentId,
        filename: documents.filename,
        heading: chunks.heading,
        pageStart: chunks.pageStart,
        pageEnd: chunks.pageEnd,
        content: chunks.content,
        score: score.mapWith(Number),
      })
      .from(chunks)
      .innerJoin(documents, eq(documents.id, chunks.documentId))
      .where(
        and(
          eq(documents.status, 'ready'),
          filter?.documentIds ? inArray(chunks.documentId, filter.documentIds) : undefined,
          match,
        ),
      )
      .orderBy(orderBy)
      .limit(limit);
  }
}
