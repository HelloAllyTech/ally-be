import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import { LoggerService } from 'src/logger/logger.service';
import { ExtractedDocument, ExtractedPage } from './extracted-document.type';

const logger = LoggerService.getInstance('PdfExtractor');

/**
 * Local path to pdfjs's bundled base-14 font data.
 *
 * Passed explicitly because without it pdfjs logs "Ensure that the `standardFontDataUrl` API
 * parameter is provided" for every document that references a standard font — which is almost
 * all of them — and would otherwise try to fetch the data over the network. Resolved from the
 * installed package rather than hard-coded so it survives a hoisting change.
 */
function standardFontDataUrl(): string {
  return `${path.dirname(require.resolve('pdfjs-dist/package.json'))}/standard_fonts/`;
}

/**
 * PDF text extraction, page by page.
 *
 * Uses pdfjs-dist rather than pdf-parse for one decisive reason: iterating pages gives REAL
 * PAGE NUMBERS, and a citation that says "p. 44" is checkable by the worker reading it while a
 * citation that says only the document title is not. pdf-parse returns one flat string, which
 * would make every PDF citation document-level — the exact limitation this whole corpus exists
 * to get past. (It is also effectively unmaintained.)
 *
 * Scanned PDFs with no text layer extract to nothing. That is reported as a failure naming OCR
 * as the fix rather than indexing an empty document, because an empty document is invisible: it
 * looks indexed, contributes nothing, and no one finds out until a question it should have
 * answered is declined.
 */
/**
 * True dynamic ESM import from a CommonJS build.
 *
 * pdfjs-dist v6 ships ESM ONLY — `legacy/build/pdf.mjs`, with no CommonJS entry point. This repo
 * compiles to CommonJS, and TypeScript downlevels a plain `await import(...)` into `require(...)`,
 * which cannot load an `.mjs` file: it fails with "Cannot use 'import.meta' outside a module" at
 * runtime, not at build time. Wrapping the import in `new Function` hides it from the compiler so
 * it stays a real dynamic import and Node's ESM loader handles it.
 *
 * The alternative was pinning pdfjs-dist to the v3 line, which still shipped a CJS legacy build.
 * Rejected deliberately: this parser is pointed at untrusted files an admin uploads, and the v3
 * line carries known parser CVEs (CVE-2024-4367 among them). A one-line loader shim is a better
 * trade than an old PDF parser.
 */
const importEsm = new Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<any>;

/**
 * Load the pdfjs module. Overridable so unit tests can inject a fake.
 *
 * Jest cannot load ESM without --experimental-vm-modules, so the real parser is unreachable from
 * the test suite; turning the whole suite's runner flags on for one module is a worse trade than
 * injecting here. The page-assembly logic below is therefore unit-tested against a fake, and the
 * real pdfjs path is verified separately by `npm run verify:pdf-extractor`.
 */
export type PdfjsLoader = () => Promise<any>;

const defaultLoader: PdfjsLoader = () =>
  // The legacy build specifically: pdfjs's default entry assumes a browser and reaches for DOM
  // globals.
  importEsm('pdfjs-dist/legacy/build/pdf.mjs');

export async function extractPdf(
  buffer: Buffer,
  loadPdfjs: PdfjsLoader = defaultLoader,
): Promise<ExtractedDocument> {
  // Loaded at call time so a parser problem fails the document that triggered it with a usable
  // message, rather than taking module load down for everything.
  const pdfjs = await loadPdfjs();

  let pdf;
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      // Fonts are irrelevant to text extraction and converting them costs memory per page on
      // large scanned documents. (There is deliberately no `disableWorker` here — it was
      // removed in pdfjs v6; the legacy build falls back to an in-process fake worker in Node
      // on its own.)
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl: standardFontDataUrl(),
    }).promise;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    // Encryption and corruption both land here, and they have different fixes, so the
    // provider's own message is passed through rather than flattened.
    throw new BadRequestException(
      `Could not open the PDF (${reason}). If it is password-protected, remove the ` +
        `protection and upload it again.`,
    );
  }

  const parts: string[] = [];
  const pages: ExtractedPage[] = [];
  let offset = 0;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    let pageText = '';
    try {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pageText = joinTextItems(content.items as TextItem[]);
      // Release the page's operator list and font data before moving on, so peak memory is one
      // page rather than the whole document. A 300-page scan otherwise holds everything.
      page.cleanup();
    } catch (error) {
      // One unreadable page must not lose the other 299. Recorded as a gap and skipped.
      logger.warn(
        `Skipping unreadable page ${pageNumber}: ${
          error instanceof Error ? error.name : 'unknown error'
        }`,
      );
    }

    const normalised = pageText.trim();
    if (!normalised) continue;

    const block = `${normalised}\n\n`;
    parts.push(block);
    pages.push({
      number: pageNumber,
      start: offset,
      end: offset + normalised.length,
    });
    offset += block.length;
  }

  const text = parts.join('').trim();

  if (!text) {
    throw new BadRequestException(
      `No text could be extracted from this PDF (${pdf.numPages} page(s)). It is most ` +
        `likely a scan with no text layer — run OCR on it first, then upload it again.`,
    );
  }

  return { text, pages, sections: [] };
}

export interface TextItem {
  str?: string;
  hasEOL?: boolean;
}

/**
 * Reassemble a page's text items into lines.
 *
 * pdfjs emits one item per run of same-styled text, with `hasEOL` marking a line break. Joining
 * them naively with spaces turns a two-column layout into interleaved gibberish and glues the
 * last word of a line onto the first of the next; honouring hasEOL keeps line structure, which
 * is what the chunker's paragraph splitting then works from.
 */
export function joinTextItems(items: TextItem[]): string {
  let out = '';
  for (const item of items) {
    const str = item?.str ?? '';
    out += str;
    if (item?.hasEOL) {
      out += '\n';
    } else if (str && !str.endsWith(' ')) {
      out += ' ';
    }
  }
  // Collapse the runs of spaces the above can leave, but keep newlines: paragraph boundaries
  // are load-bearing for chunking.
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
}
