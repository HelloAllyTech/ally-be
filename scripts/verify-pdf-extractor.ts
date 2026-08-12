/**
 * Verifies the PDF extractor against the REAL pdfjs parser.
 *
 * Exists because the jest suite cannot: pdfjs-dist v6 is ESM-only, and jest refuses a dynamic ESM
 * import without --experimental-vm-modules. Rather than turn that flag on for the whole repo's
 * test command, the suite injects a fake pdfjs (covering page iteration, span arithmetic and error
 * mapping) and this script covers the part only the real library can prove: that pdfjs actually
 * loads from a CommonJS build and returns per-page text.
 *
 * That load path is the fragile bit. TypeScript downlevels `await import()` to `require()` under
 * `module: commonjs`, which cannot load an `.mjs` file, so the extractor wraps the import in
 * `new Function` to keep it a real dynamic import. This script is what catches a regression there.
 *
 *   npm run verify:pdf-extractor
 */

import { extractDocument } from '../src/knowledge-base/extractor';
import { KbDocumentSourceType } from '../src/knowledge-base/enum/knowledge-base.enum';
import { buildPdf } from '../src/knowledge-base/extractor/test/fixture';

const PAGES = [
  ['Chapter 3 Risk assessment', 'Ask directly about intent and plan.'],
  ['Second page heading', 'Document the answer verbatim in the notes.'],
  ['Third page', 'Escalate when a plan and means are both present.'],
];

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(`  FAIL  ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  ok    ${message}`);
}

async function main(): Promise<void> {
  console.log('Verifying the PDF extractor against real pdfjs...');

  const extracted = await extractDocument({
    sourceType: KbDocumentSourceType.PDF,
    buffer: buildPdf(PAGES),
  });

  assert(extracted.pages.length === 3, 'three page spans were produced');
  assert(
    extracted.pages.map((p) => p.number).join(',') === '1,2,3',
    'page numbers are 1,2,3',
  );

  for (const [index, lines] of PAGES.entries()) {
    const page = extracted.pages.find((p) => p.number === index + 1);
    const slice = page ? extracted.text.slice(page.start, page.end) : '';
    assert(
      slice.includes(lines[0]) && slice.includes(lines[1]),
      `page ${index + 1} span contains its own text`,
    );
  }

  const pageOne = extracted.pages.find((p) => p.number === 1)!;
  assert(
    !extracted.text
      .slice(pageOne.start, pageOne.end)
      .includes('Second page heading'),
    'page 1 span does not bleed into page 2',
  );

  // The scanned-PDF path: a valid PDF with no text layer must fail loudly, not index empty.
  let rejected = false;
  try {
    await extractDocument({
      sourceType: KbDocumentSourceType.PDF,
      buffer: buildPdf([[]]),
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'a PDF with no text layer is rejected');

  console.log(
    process.exitCode
      ? 'PDF extractor verification FAILED'
      : 'PDF extractor verification passed',
  );
}

main().catch((error) => {
  console.error('PDF extractor verification threw:', error);
  process.exit(1);
});
