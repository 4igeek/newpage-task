/**
 * The common shape every parser produces: a document split into ordered
 * sections, each with whatever structural metadata the format offers.
 * Chunking works on sections, so it never needs to know the source format.
 */
export interface Section {
  text: string;
  /** Heading path, e.g. "Install > Docker". Absent for formats without headings. */
  heading?: string;
  /** 1-based page number, for paged formats (PDF). */
  page?: number;
}

export interface ParsedDocument {
  sections: Section[];
  pageCount?: number;
}
