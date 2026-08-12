import { BadRequestException } from '@nestjs/common';
import { KB_MAX_EXTRACTED_CHARS } from '../../constants/knowledge-base.constants';
import { KbDocumentSourceType } from '../../enum/knowledge-base.enum';
import { extractDocument } from '../index';
import { htmlToExtractedDocument } from '../html.util';
import { joinTextItems } from '../pdf.extractor';
import { buildDocx, buildEpub, buildPdf, fakePdfjs } from './fixture';

/**
 * These run against real parsers and real (hand-built) files, not mocks. The point of the module
 * is to get text and citable metadata out of five awkward formats, and a mocked parser would
 * verify only that the code calls a function.
 */
describe('extractDocument', () => {
  /**
   * The pdfjs module is injected here rather than loaded for real.
   *
   * pdfjs-dist v6 is ESM-only and jest cannot import ESM without --experimental-vm-modules, so
   * the real parser cannot run inside this suite — turning that flag on for the whole repo's
   * test command would be a much larger change than injecting a fake for one module. The real
   * parser is verified against buildPdf() output by `npm run verify:pdf-extractor`.
   *
   * Everything the extractor is itself responsible for is still covered below: page iteration,
   * span arithmetic, text-item joining, tolerating one bad page, and the no-text-layer failure.
   */
  describe('PDF', () => {
    const threePages = () =>
      fakePdfjs({
        pages: [
          [
            { str: 'Chapter 3 Risk assessment', hasEOL: true },
            { str: 'Ask directly about intent and plan.' },
          ],
          [
            { str: 'Second page heading', hasEOL: true },
            { str: 'Document the answer verbatim in the notes.' },
          ],
          [
            { str: 'Third page', hasEOL: true },
            { str: 'Escalate when a plan and means are both present.' },
          ],
        ],
      });

    const extractWith = (fake: ReturnType<typeof fakePdfjs>) =>
      extractDocument({
        sourceType: KbDocumentSourceType.PDF,
        buffer: buildPdf([['placeholder']]),
        loadPdfjs: async () => fake,
      });

    it('extracts text with one span per page', async () => {
      const extracted = await extractWith(threePages());

      expect(extracted.text).toContain('Ask directly about intent and plan.');
      expect(extracted.text).toContain('Escalate when a plan and means');
      // Real page numbers are the entire reason pdfjs was chosen over pdf-parse: without them
      // every PDF citation would be document-level.
      expect(extracted.pages).toHaveLength(3);
      expect(extracted.pages.map((p) => p.number)).toEqual([1, 2, 3]);
    });

    it('page spans point at that page own text', async () => {
      const extracted = await extractWith(threePages());

      const slice = (n: number) => {
        const page = extracted.pages.find((p) => p.number === n)!;
        return extracted.text.slice(page.start, page.end);
      };

      expect(slice(1)).toContain('Chapter 3 Risk assessment');
      expect(slice(2)).toContain('Second page heading');
      expect(slice(3)).toContain('Escalate when a plan');
      // A span bleeding into the next page would cite a chunk to the wrong page.
      expect(slice(1)).not.toContain('Second page heading');
      expect(slice(2)).not.toContain('Third page');
    });

    it('skips an unreadable page instead of losing the document', async () => {
      const extracted = await extractWith(
        fakePdfjs({
          pages: [
            [{ str: 'Good page one.' }],
            [{ str: 'Never reached.' }],
            [{ str: 'Good page three.' }],
          ],
          failingPages: [2],
        }),
      );

      expect(extracted.text).toContain('Good page one.');
      expect(extracted.text).toContain('Good page three.');
      // The gap is real, and the surviving pages keep their true numbers so citations stay honest.
      expect(extracted.pages.map((p) => p.number)).toEqual([1, 3]);
    });

    it('rejects a PDF with no text layer rather than indexing nothing', async () => {
      // A scan. Indexed silently it looks fine, contributes nothing, and nobody finds out until a
      // question it should have answered is declined.
      await expect(extractWith(fakePdfjs({ pages: [[], []] }))).rejects.toThrow(
        /run OCR on it first/,
      );
    });

    it('reports an unopenable PDF with a usable message', async () => {
      await expect(
        extractWith(fakePdfjs({ pages: [], failToOpen: 'password required' })),
      ).rejects.toThrow(/Could not open the PDF \(password required\)/);
    });

    it('rejects an empty upload', async () => {
      await expect(
        extractDocument({
          sourceType: KbDocumentSourceType.PDF,
          buffer: Buffer.alloc(0),
        }),
      ).rejects.toThrow(/appears to be empty/);
    });
  });

  describe('joinTextItems', () => {
    it('honours hasEOL so line structure survives', () => {
      // Joining naively with spaces glues the last word of a line onto the first of the next and
      // interleaves a two-column layout into gibberish. Line structure is also what the chunker's
      // paragraph splitting works from.
      const joined = joinTextItems([
        { str: 'First line', hasEOL: true },
        { str: 'Second line', hasEOL: true },
      ]);
      expect(joined).toBe('First line\nSecond line\n');
    });

    it('separates same-line runs with a single space', () => {
      const joined = joinTextItems([
        { str: 'Ask' },
        { str: 'directly' },
        { str: 'about intent.' },
      ]);
      expect(joined).toBe('Ask directly about intent. ');
    });

    it('collapses runs of spaces but keeps paragraph breaks', () => {
      const joined = joinTextItems([
        { str: 'One.', hasEOL: true },
        { str: '', hasEOL: true },
        { str: '', hasEOL: true },
        { str: 'Two.' },
      ]);
      expect(joined).toContain('One.');
      expect(joined).toContain('Two.');
      expect(joined).not.toMatch(/\n{3,}/);
    });
  });

  describe('DOCX', () => {
    it('extracts text and a heading trail', async () => {
      const buffer = await buildDocx([
        { style: 'Heading1', text: 'Chapter 3' },
        { text: 'Intro paragraph about assessment.' },
        { style: 'Heading2', text: 'Risk assessment' },
        { text: 'Ask directly about intent and plan.' },
      ]);

      const extracted = await extractDocument({
        sourceType: KbDocumentSourceType.DOCX,
        buffer,
      });

      expect(extracted.text).toContain('Ask directly about intent and plan.');
      // DOCX has no pages, so the heading trail is the only thing a citation can point at.
      const paths = extracted.sections.map((s) => s.path);
      expect(paths).toContain('Chapter 3');
      expect(paths).toContain('Chapter 3 > Risk assessment');
    });

    it('section spans point at the text under that heading', async () => {
      const buffer = await buildDocx([
        { style: 'Heading1', text: 'Alpha' },
        { text: 'Alpha body text here.' },
        { style: 'Heading1', text: 'Beta' },
        { text: 'Beta body text here.' },
      ]);

      const extracted = await extractDocument({
        sourceType: KbDocumentSourceType.DOCX,
        buffer,
      });

      const alpha = extracted.sections.find((s) => s.path === 'Alpha')!;
      const beta = extracted.sections.find((s) => s.path === 'Beta')!;

      expect(extracted.text.slice(alpha.start, alpha.end)).toContain(
        'Alpha body text',
      );
      // A span that leaked into the next section would attribute Beta's text to Alpha.
      expect(extracted.text.slice(alpha.start, alpha.end)).not.toContain(
        'Beta body text',
      );
      expect(extracted.text.slice(beta.start, beta.end)).toContain(
        'Beta body text',
      );
    });

    it('rejects a document with no text', async () => {
      const buffer = await buildDocx([]);
      await expect(
        extractDocument({ sourceType: KbDocumentSourceType.DOCX, buffer }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('EPUB', () => {
    it('reads chapters in SPINE order, not filename order', async () => {
      // The spine deliberately reverses the filenames. Reading order is a property of the spine;
      // a corpus stitched by filename would give every chunk the wrong surrounding context.
      const buffer = await buildEpub({
        chapters: [
          { file: 'a-second.xhtml', html: '<h1>Second</h1><p>Beta body.</p>' },
          { file: 'b-first.xhtml', html: '<h1>First</h1><p>Alpha body.</p>' },
        ],
        spine: ['ch2', 'ch1'],
        title: 'Clinical Handbook',
        language: 'en',
      });

      const extracted = await extractDocument({
        sourceType: KbDocumentSourceType.EPUB,
        buffer,
      });

      expect(extracted.text.indexOf('Alpha body')).toBeLessThan(
        extracted.text.indexOf('Beta body'),
      );
    });

    it('carries metadata and per-chapter sections in document coordinates', async () => {
      const buffer = await buildEpub({
        chapters: [
          { file: 'c1.xhtml', html: '<h1>Alpha</h1><p>Alpha body text.</p>' },
          { file: 'c2.xhtml', html: '<h1>Beta</h1><p>Beta body text.</p>' },
        ],
        spine: ['ch1', 'ch2'],
        title: 'Clinical Handbook',
        language: 'hi',
      });

      const extracted = await extractDocument({
        sourceType: KbDocumentSourceType.EPUB,
        buffer,
      });

      expect(extracted.title).toBe('Clinical Handbook');
      expect(extracted.language).toBe('hi');

      const beta = extracted.sections.find((s) => s.path === 'Beta')!;
      expect(beta).toBeDefined();
      // Chapter-local offsets shifted into whole-document coordinates: without the shift, every
      // chapter after the first would claim offsets starting at 0.
      expect(extracted.text.slice(beta.start, beta.end)).toContain(
        'Beta body text',
      );
    });

    it('rejects a non-EPUB buffer', async () => {
      await expect(
        extractDocument({
          sourceType: KbDocumentSourceType.EPUB,
          buffer: Buffer.from('not a zip'),
        }),
      ).rejects.toThrow(/Could not open the EPUB/);
    });
  });

  describe('pasted text', () => {
    it('keeps the text verbatim', async () => {
      const text = 'Ask directly about intent.\n\nRecord the answer verbatim.';
      const extracted = await extractDocument({
        sourceType: KbDocumentSourceType.PASTE,
        text,
      });

      expect(extracted.text).toBe(text);
      expect(extracted.pages).toEqual([]);
    });

    it('recognises short title-case lines as headings', async () => {
      const extracted = await extractDocument({
        sourceType: KbDocumentSourceType.PASTE,
        text: 'Risk assessment\n\nAsk directly about intent and plan.',
      });

      expect(extracted.sections.map((s) => s.path)).toContain(
        'Risk assessment',
      );
    });

    it('does not treat ordinary sentences as headings', async () => {
      // Over-eager detection would chop prose into single-sentence sections and destroy chunk
      // coherence, which is worse than having no sections at all.
      const extracted = await extractDocument({
        sourceType: KbDocumentSourceType.PASTE,
        text: 'Ask directly about intent and plan, because an implied question invites evasion.',
      });

      expect(extracted.sections).toEqual([]);
    });

    it('rejects empty text', async () => {
      await expect(
        extractDocument({
          sourceType: KbDocumentSourceType.PASTE,
          text: '   ',
        }),
      ).rejects.toThrow(/empty/);
    });
  });

  describe('size cap', () => {
    it('fails explicitly rather than truncating', async () => {
      const huge = 'word '.repeat(KB_MAX_EXTRACTED_CHARS / 4);

      await expect(
        extractDocument({
          sourceType: KbDocumentSourceType.PASTE,
          text: huge,
        }),
      ).rejects.toThrow(/Split it into parts/);
    });
  });
});

describe('htmlToExtractedDocument', () => {
  it('drops script and style bodies', () => {
    const extracted = htmlToExtractedDocument(
      '<style>.a{color:red}</style><p>Real prose.</p><script>var x=1</script>',
    );

    // Left in, CSS and JS get embedded and pollute retrieval.
    expect(extracted.text).toContain('Real prose.');
    expect(extracted.text).not.toContain('color:red');
    expect(extracted.text).not.toContain('var x');
  });

  it('builds a nested heading trail', () => {
    const extracted = htmlToExtractedDocument(
      '<h1>A</h1><p>a</p><h2>B</h2><p>b</p><h3>C</h3><p>c</p><h2>D</h2><p>d</p>',
    );

    const paths = extracted.sections.map((s) => s.path);
    expect(paths).toEqual(['A', 'A > B', 'A > B > C', 'A > D']);
  });

  it('keeps heading text in the body', () => {
    // A heading is often the most retrievable phrase in its section; dropping it would make the
    // section findable only by its contents.
    const extracted = htmlToExtractedDocument(
      '<h1>Risk assessment</h1><p>body</p>',
    );
    expect(extracted.text).toContain('Risk assessment');
  });

  it('separates block elements so paragraphs survive for chunking', () => {
    const extracted = htmlToExtractedDocument('<p>One.</p><p>Two.</p>');
    expect(extracted.text).toMatch(/One\.\s*\n\s*Two\./);
  });

  it('returns no sections for markup without headings', () => {
    const extracted = htmlToExtractedDocument('<p>Just prose.</p>');
    expect(extracted.sections).toEqual([]);
    expect(extracted.text).toBe('Just prose.');
  });
});
