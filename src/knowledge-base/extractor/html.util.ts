// `import * as` rather than a default import, matching src/common/util/sanitize-html.util.ts.
// The repo sets allowSyntheticDefaultImports but NOT esModuleInterop, so a default import here
// type-checks and then fails at runtime with "is not a function".
import * as sanitizeHtml from 'sanitize-html';
import { ExtractedDocument, ExtractedSection } from './extracted-document.type';

/**
 * Shared HTML → text conversion for the formats that arrive as markup: DOCX (via mammoth) and
 * EPUB (per-chapter XHTML), plus fetched web pages.
 *
 * Headings are extracted as SECTIONS rather than flattened away, because `section_path` is what
 * a citation falls back to when the format has no page numbers — which is every format except
 * PDF. Losing headings would make a DOCX citation say only the document title.
 *
 * Built on sanitize-html's parser hooks rather than jsdom. sanitize-html is already a
 * dependency, and this needs a text walk with open/close-tag callbacks, not a DOM; jsdom would
 * add a heavy tree to the API image for no capability gain. The hooks are used instead of
 * `transformTags` deliberately: with `allowedTags: []` every tag is disallowed, and the
 * open/close hooks still fire at the parser level where a transform on a dropped tag may not.
 */

/** Tags that force a line break before their text. */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'li',
  'tr',
  'br',
  'blockquote',
  'pre',
  'section',
  'article',
  'td',
  'th',
]);

const HEADING_LEVELS: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

interface Builder {
  parts: string[];
  length: number;
}

export function htmlToExtractedDocument(html: string): ExtractedDocument {
  const builder: Builder = { parts: [], length: 0 };
  /** Heading trail by depth, so an h3 under an h2 under an h1 reads "A > B > C". */
  const trail: (string | undefined)[] = [];
  const rawSections: { path: string; heading: string }[] = [];

  let headingLevel: number | null = null;
  let headingText = '';

  const push = (text: string) => {
    builder.parts.push(text);
    builder.length += text.length;
  };

  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    // Drop bodies that are never prose. Left in, a <style> body is extracted as text and then
    // embedded, which pollutes retrieval with CSS.
    nonTextTags: ['script', 'style', 'noscript', 'iframe', 'template', 'head'],
    onOpenTag: (name: string) => {
      if (HEADING_LEVELS[name]) {
        headingLevel = HEADING_LEVELS[name];
        headingText = '';
      } else if (BLOCK_TAGS.has(name)) {
        push('\n');
      }
    },
    onCloseTag: (name: string) => {
      const level = HEADING_LEVELS[name];
      if (!level || headingLevel !== level) return;

      const title = headingText.replace(/\s+/g, ' ').trim();
      headingLevel = null;
      headingText = '';
      if (!title) return;

      trail.length = level - 1;
      trail[level - 1] = title;
      const path = trail.filter(Boolean).join(' > ');
      // The heading text stays in the body as well: it is often the most retrievable phrase in
      // its section, and dropping it would make the section findable only by its contents.
      push(`\n${title}\n`);
      rawSections.push({ path, heading: title });
    },
    textFilter: (text: string) => {
      const decoded = text.replace(/\s+/g, ' ');
      if (headingLevel !== null) {
        headingText += decoded;
      } else {
        push(decoded);
      }
      // Return empty: sanitize-html's own output is unused, the text is accumulated above.
      return '';
    },
  } as sanitizeHtml.IOptions);

  const text = builder.parts
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, pages: [], sections: locateSections(text, rawSections) };
}

/**
 * Find each heading's span in the FINAL text.
 *
 * Offsets cannot be accumulated during the walk: the whitespace normalisation above shortens the
 * string afterwards, so any offset captured earlier would be silently wrong — pointing a
 * citation at the wrong passage, which is worse than having no section at all. Headings are
 * therefore re-located here, searching forward so repeated headings ("Assessment" under several
 * chapters) match in document order, and any heading that cannot be found is dropped rather
 * than guessed.
 */
function locateSections(
  text: string,
  rawSections: { path: string; heading: string }[],
): ExtractedSection[] {
  const found: ExtractedSection[] = [];
  let searchFrom = 0;

  for (const { path, heading } of rawSections) {
    const at = text.indexOf(heading, searchFrom);
    if (at === -1) continue;
    const start = at + heading.length;
    found.push({ path, start, end: text.length });
    searchFrom = start;
  }

  // Each section runs until the next one begins.
  for (let i = 0; i < found.length - 1; i += 1) {
    found[i].end = found[i + 1].start;
  }
  return found;
}

// For plain-text-only stripping with no section tracking, use the existing shared helper
// `htmlToPlainText` in src/common/util/sanitize-html.util.ts rather than adding a second one
// here. This module exists only for the part that helper cannot do: recovering heading spans.
