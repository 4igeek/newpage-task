import { describe, expect, it } from 'vitest';
import { detectMimeType } from '../../src/domain/file-types.js';

describe('detectMimeType', () => {
  it('detects PDFs by magic bytes regardless of extension', () => {
    expect(detectMimeType('report.bin', Buffer.from('%PDF-1.7\n...'))).toBe('application/pdf');
  });

  it('detects markdown and text by extension when the content is valid UTF-8', () => {
    expect(detectMimeType('README.md', Buffer.from('# hi'))).toBe('text/markdown');
    expect(detectMimeType('notes.TXT', Buffer.from('hi'))).toBe('text/plain');
  });

  it('rejects binary content disguised as text', () => {
    expect(detectMimeType('evil.txt', Buffer.from([0x48, 0x00, 0x49]))).toBeNull();
    expect(detectMimeType('bad.md', Buffer.from([0xff, 0xfe, 0xfd]))).toBeNull();
  });

  it('rejects unsupported extensions', () => {
    expect(detectMimeType('sheet.xlsx', Buffer.from('plain'))).toBeNull();
  });
});
