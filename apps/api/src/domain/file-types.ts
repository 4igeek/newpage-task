/**
 * Supported upload formats. The type is decided from the file's *content*
 * (magic bytes / valid UTF-8), with the extension used only to tell Markdown
 * from plain text. A client-supplied Content-Type is never trusted.
 */
export const SUPPORTED_MIME_TYPES = ['application/pdf', 'text/markdown', 'text/plain'] as const;
export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

const PDF_MAGIC = Buffer.from('%PDF-');
const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];
const TEXT_EXTENSIONS = ['.txt', '.text', ...MARKDOWN_EXTENSIONS];

export function detectMimeType(filename: string, bytes: Buffer): SupportedMimeType | null {
  const name = filename.toLowerCase();

  if (bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) return 'application/pdf';

  if (TEXT_EXTENSIONS.some((ext) => name.endsWith(ext)) && isUtf8Text(bytes)) {
    return MARKDOWN_EXTENSIONS.some((ext) => name.endsWith(ext)) ? 'text/markdown' : 'text/plain';
  }
  return null;
}

function isUtf8Text(bytes: Buffer): boolean {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // A NUL byte is a strong signal of binary content renamed to .txt.
    return !text.includes('\u0000');
  } catch {
    return false;
  }
}
