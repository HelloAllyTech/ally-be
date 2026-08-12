import { BadRequestException } from '@nestjs/common';
import { ExtractedDocument } from './extracted-document.type';
import { htmlToExtractedDocument } from './html.util';

/**
 * DOCX text extraction.
 *
 * Uses mammoth's `convertToHtml`, NOT `extractRawText`, specifically to keep the heading
 * structure: mammoth maps Word's built-in Heading 1..6 styles onto `<h1>..<h6>`, and those
 * headings become `section_path` on each chunk. Since DOCX has no page numbers, the heading trail
 * is the only thing a citation can point at — `extractRawText` would leave every DOCX citation
 * saying nothing but the document title.
 */
export async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  // Lazily imported so a broken or absent optional parser fails at call time, with the failure
  // attached to the document that triggered it, rather than at module load.
  const mammoth = await import('mammoth');

  let html: string;
  try {
    const result = await mammoth.convertToHtml({ buffer });
    html = result.value;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    throw new BadRequestException(
      `Could not read the Word document (${reason}). If it is a .doc rather than a .docx, ` +
        `re-save it as .docx and upload it again.`,
    );
  }

  const extracted = htmlToExtractedDocument(html);

  if (!extracted.text.trim()) {
    throw new BadRequestException(
      'No text could be extracted from this Word document — it appears to contain only ' +
        'images or tracked-change markup.',
    );
  }

  return extracted;
}
