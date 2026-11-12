import {
  DocumentDto,
  DocumentIdParams,
  DocumentListResponse,
  UploadResponse,
} from '@docchat/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { DomainError } from '../domain/errors.js';
import type { DocumentRecord } from '../ports/index.js';
import type { DocumentLibrary } from '../services/document-library.js';
import type { UploadDocument } from '../services/upload-document.js';

export interface DocumentRouteDeps {
  upload: UploadDocument;
  library: DocumentLibrary;
}

export const documentRoutes =
  (
    { upload, library }: DocumentRouteDeps,
    limits: { uploadPerMinute: number },
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/documents',
      {
        schema: { response: { 200: UploadResponse, 201: UploadResponse } },
        // Uploads use disk, CPU (embedding) and worker time.
        config: { rateLimit: { max: limits.uploadPerMinute, timeWindow: '1 minute' } },
      },
      async (req, reply) => {
        const file = await req.file();
        if (!file) throw new DomainError('EMPTY_FILE', 'Expected a multipart "file" field.');

        const bytes = await file.toBuffer(); // throws 413 if over the configured limit
        const result = await upload.execute({ filename: file.filename, bytes });

        req.log.info(
          { documentId: result.document.id, created: result.created, sizeBytes: bytes.length },
          'document uploaded',
        );
        return reply.status(result.created ? 201 : 200).send({
          document: toDto(result.document),
          created: result.created,
        });
      },
    );

    app.get('/documents', { schema: { response: { 200: DocumentListResponse } } }, async () => ({
      documents: (await library.list()).map(toDto),
    }));

    app.get(
      '/documents/:id',
      { schema: { params: DocumentIdParams, response: { 200: DocumentDto } } },
      async (req) => toDto(await library.get(req.params.id)),
    );

    app.delete('/documents/:id', { schema: { params: DocumentIdParams } }, async (req, reply) => {
      await library.delete(req.params.id);
      return reply.status(204).send();
    });
  };

function toDto(doc: DocumentRecord): DocumentDto {
  return {
    id: doc.id,
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    status: doc.status,
    error: doc.error,
    pageCount: doc.pageCount,
    chunkCount: doc.chunkCount,
    createdAt: doc.createdAt.toISOString(),
  };
}
