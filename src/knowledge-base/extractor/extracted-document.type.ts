/**
 * The one shape every extractor normalises to.
 *
 * This is the seam that keeps the chunker format-agnostic: it knows about sections, page
 * boundaries and character offsets, and nothing at all about PDF, DOCX, EPUB or HTML. Adding
 * a sixth format means adding one extractor, not touching the chunker.
 *
 * `pages` and `sections` are ranges over `text`, not copies of it, so nothing can drift out of
 * sync with the text the offsets refer to.
 */

/** A page's span within the extracted text. Only PDFs produce these. */
export interface ExtractedPage {
  /** 1-based page number as printed in the source. */
  number: number;
  start: number;
  end: number;
}

/** A heading's span within the extracted text. */
export interface ExtractedSection {
  /** Heading trail, e.g. 'Chapter 3 > Risk assessment'. */
  path: string;
  start: number;
  end: number;
}

export interface ExtractedDocument {
  /** The full plain text. Chunk offsets index into this and it is stored as rawText. */
  text: string;
  /**
   * Page spans, empty for formats without pages. Non-empty here is what lets a citation say
   * "p. 44" — the single biggest citation-quality difference between formats.
   */
  pages: ExtractedPage[];
  /**
   * Heading spans, empty when the format carries no headings. These are HARD chunk boundaries:
   * a chunk never spans two sections, so a passage cited as being under one heading really is.
   */
  sections: ExtractedSection[];
  /** BCP-47 tag when the format declares one (EPUB metadata, html lang). */
  language?: string;
  /** Title when the format declares one, used only when the admin left it blank. */
  title?: string;
}
