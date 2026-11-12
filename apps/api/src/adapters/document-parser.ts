import { extractText, getDocumentProxy } from 'unpdf';
import type { SupportedMimeType } from '../domain/file-types.js';
import { parseMarkdown } from '../domain/markdown.js';
import type { ParsedDocument, Section } from '../domain/sections.js';
import type { DocumentParser } from '../ports/index.js';

export class DefaultDocumentParser implements DocumentParser {
  async parse(mimeType: SupportedMimeType, bytes: Buffer): Promise<ParsedDocument> {
    switch (mimeType) {
      case 'application/pdf':
        return parsePdf(bytes);
      case 'text/markdown':
        return { sections: parseMarkdown(bytes.toString('utf8')) };
      case 'text/plain':
        return { sections: [{ text: bytes.toString('utf8') }] };
    }
  }
}

/** One section per page so every chunk can cite the page(s) it came from. */
async function parsePdf(bytes: Buffer): Promise<ParsedDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const sections: Section[] = text
    .map((pageText, i) => ({ text: cleanPdfText(pageText), page: i + 1 }))
    .filter((s) => s.text.length > 0);
  return { sections, pageCount: totalPages };
}

function cleanPdfText(text: string): string {
  return text
    .replace(/(\w)-\n(\w)/g, '$1$2') // re-join words hyphenated across lines
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
