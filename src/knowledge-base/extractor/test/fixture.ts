// `import * as`, matching the repo's CommonJS interop (no esModuleInterop) — a default import
// resolves to undefined at runtime.
import * as JSZip from 'jszip';

/**
 * Format fixtures built in code rather than committed as binaries.
 *
 * Two reasons. A hand-built fixture documents the part of the format the extractor actually
 * depends on — a reader can see that the EPUB's spine order is deliberately the reverse of its
 * filename order, which is the whole point of that test. And a binary blob in the repo is
 * unreviewable: nobody can tell from a diff whether it changed meaningfully.
 */

/** A minimal, uncompressed, multi-page PDF with real text objects. */
export function buildPdf(pages: string[][]): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const contentIds = pages.map((lines) => {
    const stream =
      'BT /F1 12 Tf 72 720 Td 14 TL\n' +
      lines.map((l) => `(${l.replace(/([()\\])/g, '\\$1')}) Tj T*`).join('\n') +
      '\nET';
    return add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  // The /Pages id is not known until its kids exist, so a placeholder is written and patched.
  const placeholderPagesId = objects.length + pages.length + 1;
  const pageIds = contentIds.map((cid) =>
    add(
      `<< /Type /Page /Parent ${placeholderPagesId} 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${cid} 0 R >>`,
    ),
  );
  const pagesId = add(
    `<< /Type /Pages /Kids [${pageIds
      .map((i) => `${i} 0 R`)
      .join(' ')}] /Count ${pageIds.length} >>`,
  );
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  for (const pid of pageIds) {
    objects[pid - 1] = objects[pid - 1].replace(
      `/Parent ${placeholderPagesId} 0 R`,
      `/Parent ${pagesId} 0 R`,
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  });
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\n` +
    `startxref\n${xref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/**
 * A minimal .docx: the OOXML parts mammoth needs, with real Heading styles so the h1/h2 mapping
 * (and therefore section_path) is exercised rather than assumed.
 */
export async function buildDocx(
  blocks: { style?: 'Heading1' | 'Heading2'; text: string }[],
): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );

  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
</w:styles>`,
  );

  const body = blocks
    .map(({ style, text }) => {
      const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
      return `<w:p>${pPr}<w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
    })
    .join('');

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`,
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * A minimal .epub.
 *
 * The spine order is deliberately NOT the filename order, which is the behaviour worth testing:
 * reading order comes from the spine, and stitching chapters together by filename would silently
 * scramble a real book.
 */
export async function buildEpub(options: {
  chapters: { file: string; html: string }[];
  /** Manifest ids in reading order. */
  spine: string[];
  title?: string;
  language?: string;
}): Promise<Buffer> {
  const zip = new JSZip();

  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  const manifest = options.chapters
    .map(
      (c, i) =>
        `<item id="ch${i + 1}" href="${c.file}" media-type="application/xhtml+xml"/>`,
    )
    .join('');
  const spine = options.spine.map((id) => `<itemref idref="${id}"/>`).join('');

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(options.title ?? 'Untitled')}</dc:title>
    <dc:language>${options.language ?? 'en'}</dc:language>
  </metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`,
  );

  for (const chapter of options.chapters) {
    zip.file(
      `OEBPS/${chapter.file}`,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>${chapter.html}</body></html>`,
    );
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * A stand-in for the pdfjs module, shaped like the small part of its API the extractor uses.
 *
 * Needed because jest cannot import ESM without --experimental-vm-modules and pdfjs-dist v6 is
 * ESM-only, so the real parser is unreachable from the suite. The real parser is covered instead
 * by `npm run verify:pdf-extractor`, which runs it against buildPdf() output under plain node.
 *
 * What this fake still exercises is everything the extractor itself is responsible for: page
 * iteration, per-page span arithmetic, text-item joining, skipping an unreadable page, and the
 * no-text-layer failure.
 */
export function fakePdfjs(options: {
  /** One entry per page; each entry is that page's text items. */
  pages: { str: string; hasEOL?: boolean }[][];
  /** 1-based page numbers whose getPage/getTextContent should throw. */
  failingPages?: number[];
  /** Make getDocument itself reject, simulating an encrypted or corrupt file. */
  failToOpen?: string;
}) {
  const failing = new Set(options.failingPages ?? []);
  return {
    getDocument: () => ({
      promise: options.failToOpen
        ? Promise.reject(new Error(options.failToOpen))
        : Promise.resolve({
            numPages: options.pages.length,
            getPage: (n: number) => {
              if (failing.has(n)) {
                return Promise.reject(new Error(`page ${n} is unreadable`));
              }
              return Promise.resolve({
                getTextContent: () =>
                  Promise.resolve({ items: options.pages[n - 1] ?? [] }),
                cleanup: () => true,
              });
            },
          }),
    }),
  };
}
