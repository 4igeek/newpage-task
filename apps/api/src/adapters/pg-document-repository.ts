import { desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { documents, jobs } from '../db/schema.js';
import type { SupportedMimeType } from '../domain/file-types.js';
import type { DocumentRecord, DocumentRepository, NewDocument } from '../ports/index.js';

// Columns are qualified by hand: Drizzle renders `${documents.id}` as a bare
// "id" here, which inside the subquery would silently bind to chunks.id.
const chunkCount = sql<number>`(select count(*)::int from chunks where chunks.document_id = documents.id)`;
const selection = { ...getTableColumns(documents), chunkCount };

type Row = typeof documents.$inferSelect & { chunkCount: number };
const toRecord = (row: Row): DocumentRecord => ({
  ...row,
  // The column is plain text in the DB; only supported types are ever written.
  mimeType: row.mimeType as SupportedMimeType,
});

export class PgDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Database) {}

  async createWithIngestJob(doc: NewDocument) {
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(documents)
        .values(doc)
        // Two concurrent uploads of the same file: the loser gets the winner's row.
        .onConflictDoNothing({ target: documents.contentHash })
        .returning({ id: documents.id });

      if (!inserted) {
        const existing = await this.findByHash(doc.contentHash);
        if (!existing) throw new Error('document vanished after conflict');
        return { document: existing, created: false };
      }

      await tx.insert(jobs).values({ type: 'ingest_document', documentId: inserted.id });
      const [row] = await tx.select(selection).from(documents).where(eq(documents.id, inserted.id));
      if (!row) throw new Error('inserted document not found');
      return { document: toRecord(row), created: true };
    });
  }

  async findById(id: string) {
    const [row] = await this.db.select(selection).from(documents).where(eq(documents.id, id));
    return row ? toRecord(row) : null;
  }

  async findByHash(contentHash: string) {
    const [row] = await this.db
      .select(selection)
      .from(documents)
      .where(eq(documents.contentHash, contentHash));
    return row ? toRecord(row) : null;
  }

  async list() {
    const rows = await this.db.select(selection).from(documents).orderBy(desc(documents.createdAt));
    return rows.map(toRecord);
  }

  async setStatus(
    id: string,
    status: DocumentRecord['status'],
    extra: { error?: string | null; pageCount?: number | null } = {},
  ) {
    await this.db
      .update(documents)
      .set({ status, ...extra })
      .where(eq(documents.id, id));
  }

  async delete(id: string) {
    const [row] = await this.db.delete(documents).where(eq(documents.id, id)).returning();
    return row ? toRecord({ ...row, chunkCount: 0 }) : null;
  }
}
