import { BadRequestException } from '@nestjs/common';
import { KB_MAX_EXTRACTED_CHARS } from '../constants/knowledge-base.constants';
import { KbDocumentSourceType } from '../enum/knowledge-base.enum';
import { extractDocx } from './docx.extractor';
import { ExtractedDocument, ExtractedSection } from './extracted-document.type';
import { extractEpub } from './epub.extractor';
import { extractPdf, PdfjsLoader } from './pdf.extractor';
import { extractUrl } from './url.extractor';

export * from './extracted-document.type';

export interface ExtractInput {
  sourceType: KbDocumentSourceType;
  /** File bytes for pdf/docx/epub. */
  buffer?: Buffer;
  /** Pasted body for PASTE, or the URL for URL. */
  text?: string;
  sourceUrl?: string;
  /**
   * Test seam only: overrides how pdfjs is loaded. Jest cannot load ESM without
   * --experimental-vm-modules, so unit tests inject a fake here; production always uses the
   * default loader.
   */
  loadPdfjs?: PdfjsLoader;
}

/**
 * Extract one document into the single normalised shape the chunker consumes.
 *
 * The only place that knows which parser belongs to which source type. Adding a sixth format is
 * one extractor plus one case here; nothing downstream changes.
 */
export async function extractDocument(
  input: ExtractInput,
): Promise<ExtractedDocument> {
  const extracted = await runExtractor(input);
  return enforceSizeCap(normalise(extracted));
}

async function runExtractor(input: ExtractInput): Promise<ExtractedDocument> {
  switch (input.sourceType) {
    case KbDocumentSourceType.PASTE:
      return extractPastedText(input.text ?? '');

    case KbDocumentSourceType.PDF:
      return extractPdf(requireBuffer(input, 'PDF'), input.loadPdfjs);

    case KbDocumentSourceType.DOCX:
      return extractDocx(requireBuffer(input, 'Word document'));

    case KbDocumentSourceType.EPUB:
      return extractEpub(requireBuffer(input, 'EPUB'));

    case KbDocumentSourceType.URL: {
      const url = input.sourceUrl ?? input.text ?? '';
      if (!url.trim()) {
        throw new BadRequestException('A URL is required for a URL document.');
      }
      return extractUrl(url.trim());
    }

    default:
      // Exhaustive today; a new enum member without a case here must fail loudly rather than
      // ingest an empty document that looks successfully indexed.
      throw new BadRequestException(
        `Unsupported document source type: ${String(input.sourceType)}`,
      );
  }
}

function requireBuffer(input: ExtractInput, label: string): Buffer {
  if (!input.buffer?.length) {
    throw new BadRequestException(
      `The uploaded ${label} could not be read — the file appears to be empty.`,
    );
  }
  return input.buffer;
}

/**
 * Pasted text carries no pages, but blank-line-separated ALL-CAPS or Title-Case single lines are
 * usually headings, so a light heuristic recovers a section trail. Deliberately conservative: a
 * false heading costs a slightly odd `section_path` on one chunk, while over-eager detection would
 * chop prose into single-sentence sections and destroy chunk coherence.
 */
function extractPastedText(text: string): ExtractedDocument {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new BadRequestException('The document text is empty.');
  }

  const sections: ExtractedSection[] = [];
  const lines = trimmed.split('\n');
  let offset = 0;

  for (const line of lines) {
    const candidate = line.trim();
    const isHeading =
      candidate.length > 0 &&
      candidate.length <= 80 &&
      !/[.!?;:]$/.test(candidate) &&
      /^[A-Z0-9]/.test(candidate) &&
      candidate.split(/\s+/).length <= 10;

    if (isHeading) {
      if (sections.length) sections[sections.length - 1].end = offset;
      sections.push({
        path: candidate,
        start: offset + line.length,
        end: trimmed.length,
      });
    }
    offset += line.length + 1;
  }

  return { text: trimmed, pages: [], sections };
}

/**
 * Normalise line endings and collapse runaway blank lines.
 *
 * Done once, centrally, AFTER extraction and before offsets are used: every offset in `pages` and
 * `sections` refers to `text`, so any rewriting of `text` downstream would silently invalidate
 * them. Extractors already return their spans against their own final text, so this only touches
 * characters that do not shift them — CRLF → LF is length-changing, so it runs before spans are
 * trusted, and extractors are documented to hand back text already free of \r.
 */
function normalise(extracted: ExtractedDocument): ExtractedDocument {
  if (!extracted.text.includes('\r')) return extracted;

  // A \r removal would shift every offset, so rather than patch spans we drop them: a chunk with
  // no page or section is merely less precisely citable, whereas a chunk with the WRONG page is a
  // citation that points a worker at text that does not say what was claimed.
  return {
    ...extracted,
    text: extracted.text.replace(/\r\n?/g, '\n'),
    pages: [],
    sections: [],
  };
}

function enforceSizeCap(extracted: ExtractedDocument): ExtractedDocument {
  if (extracted.text.length <= KB_MAX_EXTRACTED_CHARS) return extracted;

  // Explicit failure, never truncation. A silently truncated document reads as fully indexed
  // while two thirds of it is unsearchable, and nobody finds out until a question it should have
  // answered is declined.
  throw new BadRequestException(
    `This document extracted to ${extracted.text.length.toLocaleString()} characters, over ` +
      `the ${KB_MAX_EXTRACTED_CHARS.toLocaleString()} limit. Split it into parts and upload ` +
      `them separately.`,
  );
}
