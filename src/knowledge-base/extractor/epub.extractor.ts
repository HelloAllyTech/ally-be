import { BadRequestException } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { LoggerService } from 'src/logger/logger.service';
import { ExtractedDocument, ExtractedSection } from './extracted-document.type';
import { htmlToExtractedDocument } from './html.util';

const logger = LoggerService.getInstance('EpubExtractor');

/**
 * EPUB text extraction.
 *
 * An EPUB is a ZIP of XHTML documents plus an OPF manifest, so this reads it directly with
 * jszip + fast-xml-parser rather than adding an EPUB-specific wrapper library. Two reasons: the
 * work is genuinely small (locate the OPF, read the spine, concatenate chapters in order), and
 * the wrapper libraries in this space are thin, variably maintained, and mostly callback-based.
 *
 * Reading the SPINE rather than just globbing every .xhtml in the archive is what gets chapter
 * ORDER right. Filename order is not reading order in a real EPUB, and a corpus stitched together
 * out of order produces chunks whose surrounding context is a different chapter — retrievable and
 * subtly wrong.
 */
export async function extractEpub(buffer: Buffer): Promise<ExtractedDocument> {
  // No `.default` here: the repo compiles to CommonJS without esModuleInterop, so a dynamic
  // import of a CJS module yields the module's own export (jszip's constructor) and `.default`
  // is undefined. Reaching for `.default` type-checks fine and then throws
  // "is not a constructor" at runtime.
  const JSZip = await import('jszip');

  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new BadRequestException(
      `Could not open the EPUB (${reason}). The file may be corrupt or DRM-protected.`,
    );
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
  });

  const opfPath = await findOpfPath(zip, parser);
  const opfXml = await readFile(zip, opfPath);
  if (!opfXml) {
    throw new BadRequestException(
      'This EPUB has no readable package document (OPF), so its chapter order cannot be determined.',
    );
  }

  const opf = parser.parse(opfXml);
  const pkg = opf?.package ?? {};
  const basePath = opfPath.includes('/')
    ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1)
    : '';

  const hrefById = manifestHrefById(pkg);
  const spineIds = spineOrder(pkg);

  const parts: string[] = [];
  const sections: ExtractedSection[] = [];
  let offset = 0;

  for (const id of spineIds) {
    const href = hrefById.get(id);
    if (!href) continue;
    const xhtml = await readFile(zip, `${basePath}${href}`);
    if (!xhtml) continue;

    const chapter = htmlToExtractedDocument(xhtml);
    const chapterText = chapter.text.trim();
    if (!chapterText) continue;

    // Shift the chapter's own heading spans into whole-document coordinates. Without this every
    // chapter's sections would claim offsets from 0 and all but the first would be wrong.
    for (const section of chapter.sections) {
      sections.push({
        path: section.path,
        start: section.start + offset,
        end: Math.min(section.end + offset, offset + chapterText.length),
      });
    }

    const block = `${chapterText}\n\n`;
    parts.push(block);
    offset += block.length;
  }

  const text = parts.join('').trim();
  if (!text) {
    throw new BadRequestException(
      'No text could be extracted from this EPUB — no readable chapters were found in its spine.',
    );
  }

  return {
    text,
    pages: [],
    sections,
    title: metadataValue(pkg, 'title'),
    language: metadataValue(pkg, 'language'),
  };
}

/**
 * Locate the OPF via META-INF/container.xml, which is the only file an EPUB guarantees at a fixed
 * path. Guessing at 'content.opf' works for many books and fails for the rest, so the container
 * is read first and a scan is only the fallback.
 */
async function findOpfPath(
  zip: { file: (p: string) => unknown; files: Record<string, unknown> },
  parser: XMLParser,
): Promise<string> {
  const containerXml = await readFile(zip, 'META-INF/container.xml');
  if (containerXml) {
    try {
      const parsed = parser.parse(containerXml);
      const rootfile = parsed?.container?.rootfiles?.rootfile;
      const entry = Array.isArray(rootfile) ? rootfile[0] : rootfile;
      const fullPath = entry?.['@full-path'];
      if (typeof fullPath === 'string' && fullPath) return fullPath;
    } catch {
      logger.warn('EPUB container.xml was unparsable; falling back to a scan');
    }
  }

  const opf = Object.keys(zip.files).find((name) => name.endsWith('.opf'));
  if (!opf) {
    throw new BadRequestException(
      'This EPUB contains no package document (.opf) and cannot be read.',
    );
  }
  return opf;
}

async function readFile(
  zip: { file: (p: string) => unknown },
  path: string,
): Promise<string | null> {
  const entry = zip.file(path) as {
    async: (t: string) => Promise<string>;
  } | null;
  if (!entry) return null;
  try {
    return await entry.async('text');
  } catch {
    logger.warn(`Could not read EPUB entry: ${path}`);
    return null;
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function manifestHrefById(pkg: Record<string, any>): Map<string, string> {
  const items = asArray(pkg?.manifest?.item);
  const map = new Map<string, string>();
  for (const item of items) {
    const id = item?.['@id'];
    const href = item?.['@href'];
    const mediaType = item?.['@media-type'] ?? '';
    // Only XHTML content documents hold prose; images, CSS and fonts are skipped.
    if (
      typeof id === 'string' &&
      typeof href === 'string' &&
      /xhtml|html/.test(String(mediaType))
    ) {
      map.set(id, decodeURIComponent(href));
    }
  }
  return map;
}

function spineOrder(pkg: Record<string, any>): string[] {
  const refs = asArray(pkg?.spine?.itemref);
  const ids = refs
    .map((ref) => ref?.['@idref'])
    .filter((id): id is string => typeof id === 'string');
  if (ids.length) return ids;

  // A spine-less EPUB is malformed but recoverable: fall back to manifest order, which at least
  // usually reflects reading order, and note it rather than failing the ingest.
  logger.warn('EPUB has no spine; falling back to manifest order');
  return asArray(pkg?.manifest?.item)
    .map((item) => item?.['@id'])
    .filter((id): id is string => typeof id === 'string');
}

function metadataValue(
  pkg: Record<string, any>,
  key: string,
): string | undefined {
  const metadata = pkg?.metadata ?? {};
  const raw = metadata[`dc:${key}`] ?? metadata[key];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first === 'string') return first.trim() || undefined;
  if (
    first &&
    typeof first === 'object' &&
    typeof first['#text'] === 'string'
  ) {
    return first['#text'].trim() || undefined;
  }
  return undefined;
}
