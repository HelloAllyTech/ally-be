import { encode } from 'gpt-tokenizer';
import {
  KB_CHUNK_MAX_TOKENS,
  KB_CHUNK_OVERLAP_TOKENS,
  KB_CHUNK_TARGET_TOKENS,
} from '../constants/knowledge-base.constants';
import {
  ExtractedDocument,
  ExtractedPage,
  ExtractedSection,
} from '../extractor/extracted-document.type';

/**
 * One produced chunk. Offsets index into the ExtractedDocument's `text`, so every chunk can be
 * traced back to the exact characters it came from — which is what makes a citation checkable.
 */
export interface Chunk {
  chunkIndex: number;
  text: string;
  charStart: number;
  charEnd: number;
  pageFrom: number;
  pageTo: number;
  sectionPath: string | null;
  tokenCount: number;
}

/** A candidate split point with its span, produced by the splitting hierarchy. */
interface Piece {
  text: string;
  start: number;
  end: number;
  tokens: number;
}

/**
 * Split a document into overlapping, token-sized, section-respecting chunks.
 *
 * The hierarchy is: document → section → paragraph → sentence → hard token cut. Each level is only
 * used when the level above produced something too big, so natural boundaries win wherever they
 * exist and the hard cut is a last resort for a single pathological sentence.
 *
 * SECTIONS ARE HARD BOUNDARIES. A chunk never spans two headings, even when that leaves a short
 * chunk. This costs a little packing efficiency and buys the thing the whole citation chain rests
 * on: a passage cited as being under "Chapter 3 > Risk assessment" really is entirely from there.
 * A chunk straddling two sections would have to be attributed to one of them, which makes the
 * citation a guess.
 *
 * Token counting uses gpt-tokenizer's default cl100k_base encoding, matching
 * text-embedding-3-small. A mismatched encoding would not break anything visibly — it would just
 * make every "400 token" chunk quietly the wrong size.
 */
export function chunkDocument(extracted: ExtractedDocument): Chunk[] {
  const { text } = extracted;
  if (!text.trim()) return [];

  const spans = sectionSpans(text, extracted.sections);
  const chunks: Chunk[] = [];

  for (const span of spans) {
    const body = text.slice(span.start, span.end);
    if (!body.trim()) continue;

    for (const piece of packPieces(splitIntoPieces(body, span.start))) {
      const trimmed = trimSpan(text, piece.start, piece.end);
      if (!trimmed) continue;

      const { pageFrom, pageTo } = pageRange(
        extracted.pages,
        trimmed.start,
        trimmed.end,
      );
      chunks.push({
        chunkIndex: chunks.length,
        text: trimmed.text,
        charStart: trimmed.start,
        charEnd: trimmed.end,
        pageFrom,
        pageTo,
        sectionPath: span.path,
        tokenCount: countTokens(trimmed.text),
      });
    }
  }

  return chunks;
}

export function countTokens(text: string): number {
  // gpt-tokenizer's default export is cl100k_base, which is what text-embedding-3-small uses.
  return encode(text).length;
}

/**
 * Turn heading spans into a complete, non-overlapping cover of the document.
 *
 * Extractors report only where headings are, so the text before the first heading (a preface, or
 * the entire document when there are no headings at all) has no span. Without filling that gap
 * the content would be silently dropped — a document that indexes as zero chunks while reporting
 * success.
 */
function sectionSpans(
  text: string,
  sections: ExtractedSection[],
): { path: string | null; start: number; end: number }[] {
  const sorted = [...sections]
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  if (!sorted.length) return [{ path: null, start: 0, end: text.length }];

  const spans: { path: string | null; start: number; end: number }[] = [];
  if (sorted[0].start > 0) {
    spans.push({ path: null, start: 0, end: sorted[0].start });
  }
  for (let i = 0; i < sorted.length; i += 1) {
    const end = i + 1 < sorted.length ? sorted[i + 1].start : text.length;
    if (end > sorted[i].start) {
      spans.push({ path: sorted[i].path, start: sorted[i].start, end });
    }
  }
  return spans;
}

/**
 * Break a section into the smallest pieces worth packing: paragraphs, then sentences for any
 * paragraph over the max, then a hard token cut for any single sentence over the max.
 */
function splitIntoPieces(body: string, offset: number): Piece[] {
  const pieces: Piece[] = [];

  for (const para of splitWithOffsets(body, /\n{2,}/g)) {
    const paraTokens = countTokens(para.text);
    if (paraTokens <= KB_CHUNK_MAX_TOKENS) {
      pieces.push({ ...shift(para, offset), tokens: paraTokens });
      continue;
    }

    for (const sentence of splitWithOffsets(para.text, /(?<=[.!?])\s+/g)) {
      const abs = shift(sentence, offset + para.start);
      const sentenceTokens = countTokens(sentence.text);
      if (sentenceTokens <= KB_CHUNK_MAX_TOKENS) {
        pieces.push({ ...abs, tokens: sentenceTokens });
        continue;
      }
      // A single sentence over the max is pathological (a table flattened to one line, a
      // reference list with no punctuation). Cut it on whitespace so no word is split.
      pieces.push(...hardCut(abs));
    }
  }

  return pieces.filter((p) => p.text.trim().length > 0);
}

function splitWithOffsets(
  body: string,
  separator: RegExp,
): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  let cursor = 0;
  const re = new RegExp(
    separator.source,
    separator.flags.includes('g') ? separator.flags : `${separator.flags}g`,
  );

  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > cursor) {
      out.push({
        text: body.slice(cursor, match.index),
        start: cursor,
        end: match.index,
      });
    }
    cursor = match.index + match[0].length;
    // Zero-length matches would loop forever.
    if (match[0].length === 0) re.lastIndex += 1;
  }
  if (cursor < body.length) {
    out.push({ text: body.slice(cursor), start: cursor, end: body.length });
  }
  return out;
}

function shift(
  piece: { text: string; start: number; end: number },
  offset: number,
): { text: string; start: number; end: number } {
  return {
    text: piece.text,
    start: piece.start + offset,
    end: piece.end + offset,
  };
}

function hardCut(piece: { text: string; start: number; end: number }): Piece[] {
  const out: Piece[] = [];
  const words = splitWithOffsets(piece.text, /\s+/g);
  let bucket: { start: number; end: number } | null = null;
  let tokens = 0;

  const flush = () => {
    if (!bucket) return;
    out.push({
      text: piece.text.slice(bucket.start, bucket.end),
      start: piece.start + bucket.start,
      end: piece.start + bucket.end,
      tokens,
    });
    bucket = null;
    tokens = 0;
  };

  for (const word of words) {
    const wordTokens = countTokens(word.text);
    if (bucket && tokens + wordTokens > KB_CHUNK_TARGET_TOKENS) flush();
    if (!bucket) bucket = { start: word.start, end: word.end };
    else bucket.end = word.end;
    tokens += wordTokens;
  }
  flush();
  return out;
}

/**
 * Greedily pack pieces up to the target, then start the next chunk with an overlap of the previous
 * chunk's trailing pieces.
 *
 * Overlap is measured in whole pieces rather than raw tokens so a chunk always begins at a sentence
 * or paragraph boundary. Starting mid-sentence would put a fragment at the top of a retrieved
 * passage, which reads to the model as context it cannot resolve.
 */
function packPieces(pieces: Piece[]): { start: number; end: number }[] {
  if (!pieces.length) return [];

  // Spans only, deliberately no text: the chunk's text is re-sliced from the document by the
  // caller, so the offsets stay the single source of truth. Carrying a copy of the text here
  // would let the two drift, and the offsets are what a citation resolves through.
  const chunks: { start: number; end: number }[] = [];
  let current: Piece[] = [];
  let tokens = 0;

  const flush = () => {
    if (!current.length) return;
    chunks.push({
      start: current[0].start,
      end: current[current.length - 1].end,
    });
  };

  for (const piece of pieces) {
    if (current.length && tokens + piece.tokens > KB_CHUNK_TARGET_TOKENS) {
      flush();
      current = overlapTail(current);
      tokens = current.reduce((sum, p) => sum + p.tokens, 0);
    }
    current.push(piece);
    tokens += piece.tokens;
  }
  flush();

  return chunks;
}

/** The trailing pieces of a chunk that should also open the next one. */
function overlapTail(current: Piece[]): Piece[] {
  if (KB_CHUNK_OVERLAP_TOKENS <= 0) return [];

  const tail: Piece[] = [];
  let tokens = 0;
  for (let i = current.length - 1; i >= 0; i -= 1) {
    // Never carry the whole chunk forward: with a single oversized piece that would repeat it
    // indefinitely and never advance, producing an infinite stream of identical chunks.
    if (tail.length && tokens + current[i].tokens > KB_CHUNK_OVERLAP_TOKENS)
      break;
    tail.unshift(current[i]);
    tokens += current[i].tokens;
    if (tokens >= KB_CHUNK_OVERLAP_TOKENS) break;
  }
  return tail.length === current.length ? tail.slice(1) : tail;
}

/** Trim whitespace off a span while keeping the offsets honest. */
function trimSpan(
  text: string,
  start: number,
  end: number,
): { text: string; start: number; end: number } | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) s += 1;
  while (e > s && /\s/.test(text[e - 1])) e -= 1;
  if (s >= e) return null;
  return { text: text.slice(s, e), start: s, end: e };
}

/** The 1-based page range a span falls in. Zeroes when the format has no pages. */
function pageRange(
  pages: ExtractedPage[],
  start: number,
  end: number,
): { pageFrom: number; pageTo: number } {
  if (!pages.length) return { pageFrom: 0, pageTo: 0 };

  let pageFrom = 0;
  let pageTo = 0;
  for (const page of pages) {
    // Any overlap counts: a chunk spanning a page break legitimately cites both pages.
    if (page.end > start && page.start < end) {
      if (!pageFrom) pageFrom = page.number;
      pageTo = page.number;
    }
  }
  return { pageFrom, pageTo: pageTo || pageFrom };
}
