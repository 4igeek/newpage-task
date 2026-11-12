import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BlobStore } from '../ports/index.js';

const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Stores blobs on the local filesystem (a Docker volume in compose).
 * Production would use an S3/GCS/R2 adapter implementing the same interface.
 *
 * Layout: <root>/ab/abcdef... (two-char fan-out keeps directories small).
 */
export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(join(path, '..'), { recursive: true });
    // Write to a temp file then rename: readers never see a half-written blob.
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    // Keys are content hashes; validating them rules out path traversal.
    if (!SHA256_HEX.test(key)) throw new Error(`Invalid blob key: ${key}`);
    return join(this.root, key.slice(0, 2), key);
  }
}
