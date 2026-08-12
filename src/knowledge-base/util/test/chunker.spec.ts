import {
  KB_CHUNK_MAX_TOKENS,
  KB_CHUNK_TARGET_TOKENS,
} from '../../constants/knowledge-base.constants';
import { ExtractedDocument } from '../../extractor/extracted-document.type';
import { chunkDocument, countTokens } from '../chunker';

/**
 * The chunker's failures are all silent ones: an offset that no longer points at the text it
 * claims, a chunk attributed to the wrong section, or content dropped entirely. None of those
 * show up as an error — they show up months later as a citation that does not say what the answer
 * claimed. So the assertions here are mostly invariants rather than examples.
 */

const doc = (over: Partial<ExtractedDocument> = {}): ExtractedDocument => ({
  text: '',
  pages: [],
  sections: [],
  ...over,
});

/** Prose long enough to force multiple chunks. */
function longProse(paragraphs: number): string {
  const para =
    'Ask directly about intent and plan rather than leaving the question implied, ' +
    'because an implied question invites an evasive answer and a worker cannot act on ' +
    'an evasion. Record the response in the notes using the client own words.';
  return Array.from({ length: paragraphs }, () => para).join('\n\n');
}

describe('chunkDocument', () => {
  it('returns nothing for empty or whitespace-only text', () => {
    expect(chunkDocument(doc({ text: '' }))).toEqual([]);
    expect(chunkDocument(doc({ text: '   \n\n  ' }))).toEqual([]);
  });

  it('keeps a short document as a single chunk', () => {
    const text = 'Ask directly about intent.';
    const chunks = chunkDocument(doc({ text }));

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
    expect(chunks[0].chunkIndex).toBe(0);
  });

  describe('offset integrity', () => {
    it('every chunk offset slices back to exactly that chunk text', () => {
      const text = longProse(20);
      const chunks = chunkDocument(doc({ text }));

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        // This is the invariant the whole citation chain rests on: the admin log resolves a
        // citation by slicing rawText with these offsets, so if they drift the worker is shown
        // different words from the ones the answer used.
        expect(text.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
      }
    });

    it('offsets are monotonically non-decreasing and within bounds', () => {
      const text = longProse(20);
      const chunks = chunkDocument(doc({ text }));

      let previousStart = -1;
      for (const chunk of chunks) {
        expect(chunk.charStart).toBeGreaterThanOrEqual(previousStart);
        expect(chunk.charEnd).toBeLessThanOrEqual(text.length);
        expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
        previousStart = chunk.charStart;
      }
    });

    it('chunk indexes are contiguous from zero', () => {
      const chunks = chunkDocument(doc({ text: longProse(20) }));
      expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    });

    it('no chunk starts or ends on whitespace', () => {
      const chunks = chunkDocument(doc({ text: longProse(12) }));
      for (const chunk of chunks) {
        expect(chunk.text).toBe(chunk.text.trim());
      }
    });
  });

  describe('coverage', () => {
    it('loses no words from a document with no headings', () => {
      const text = longProse(15);
      const chunks = chunkDocument(doc({ text }));

      // Overlap means chunks repeat words, so coverage is checked as a set rather than a
      // concatenation. Dropping content silently is the failure being guarded against: the
      // document would report as indexed while part of it is unsearchable.
      const covered = new Set(
        chunks.flatMap((c) => c.text.split(/\s+/).filter(Boolean)),
      );
      for (const word of new Set(text.split(/\s+/).filter(Boolean))) {
        expect(covered.has(word)).toBe(true);
      }
    });

    it('includes text that precedes the first heading', () => {
      // A preface has no section span of its own. Without the gap-filling in sectionSpans it
      // would be dropped entirely.
      const preface =
        'This preface sits before any heading and must still be indexed.';
      const text = `${preface}\n\nRisk assessment\n\n${longProse(2)}`;
      const chunks = chunkDocument(
        doc({
          text,
          sections: [
            {
              path: 'Risk assessment',
              start: text.indexOf('Risk assessment') + 'Risk assessment'.length,
              end: text.length,
            },
          ],
        }),
      );

      const all = chunks.map((c) => c.text).join(' ');
      expect(all).toContain('This preface sits before any heading');
    });
  });

  describe('sections are hard boundaries', () => {
    it('never lets one chunk span two sections', () => {
      const a = 'Alpha section body sentence one. Alpha body sentence two.';
      const b = 'Beta section body sentence one. Beta body sentence two.';
      const text = `Alpha\n\n${a}\n\nBeta\n\n${b}`;
      const alphaStart = text.indexOf(a);
      const betaStart = text.indexOf(b);

      const chunks = chunkDocument(
        doc({
          text,
          sections: [
            { path: 'Alpha', start: alphaStart, end: betaStart },
            { path: 'Beta', start: betaStart, end: text.length },
          ],
        }),
      );

      for (const chunk of chunks) {
        const mentionsAlpha = chunk.text.includes('Alpha body');
        const mentionsBeta = chunk.text.includes('Beta body');
        // A chunk containing both would have to be attributed to one section, making its
        // citation a guess.
        expect(mentionsAlpha && mentionsBeta).toBe(false);
      }
    });

    it('labels each chunk with its own section path', () => {
      const text = `Alpha\n\n${longProse(3)}\n\nBeta\n\n${longProse(3)}`;
      const betaHeading = text.lastIndexOf('Beta');
      const chunks = chunkDocument(
        doc({
          text,
          sections: [
            {
              path: 'Alpha',
              start: text.indexOf('Alpha') + 5,
              end: betaHeading,
            },
            { path: 'Beta', start: betaHeading + 4, end: text.length },
          ],
        }),
      );

      const paths = new Set(chunks.map((c) => c.sectionPath));
      expect(paths).toContain('Alpha');
      expect(paths).toContain('Beta');
    });

    it('uses a null section path when the format has no headings', () => {
      const chunks = chunkDocument(doc({ text: 'Short body.' }));
      expect(chunks[0].sectionPath).toBeNull();
    });
  });

  describe('sizing', () => {
    it('keeps chunks at or under the max token size', () => {
      const chunks = chunkDocument(doc({ text: longProse(30) }));
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(KB_CHUNK_MAX_TOKENS);
      }
    });

    it('reports a token count matching the chunk text', () => {
      const chunks = chunkDocument(doc({ text: longProse(8) }));
      for (const chunk of chunks) {
        // ally-ai budgets its prompt context from this number without re-tokenising, so a wrong
        // count silently overflows or under-fills the context.
        expect(chunk.tokenCount).toBe(countTokens(chunk.text));
      }
    });

    it('splits a single oversized sentence rather than emitting it whole', () => {
      // A table flattened onto one line: no sentence punctuation anywhere.
      const monster = Array.from({ length: 3000 }, (_, i) => `cell${i}`).join(
        ' ',
      );
      const chunks = chunkDocument(doc({ text: monster }));

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(KB_CHUNK_MAX_TOKENS);
      }
    });

    it('terminates on a document made of one huge unbroken token run', () => {
      // Guards the overlap loop: carrying a whole chunk forward as overlap would never advance
      // and would emit identical chunks forever.
      const text = 'x'.repeat(20000);
      const chunks = chunkDocument(doc({ text }));
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.length).toBeLessThan(500);
    });
  });

  describe('overlap', () => {
    it('consecutive chunks in the same section share trailing content', () => {
      const chunks = chunkDocument(doc({ text: longProse(20) }));
      expect(chunks.length).toBeGreaterThan(1);

      // Overlap exists so a definition split across a boundary survives intact in one of the two
      // neighbours. Checked as a span overlap rather than a string match, since the second chunk
      // starts at a sentence boundary inside the first.
      const overlapping = chunks
        .slice(1)
        .filter((chunk, i) => chunk.charStart < chunks[i].charEnd);
      expect(overlapping.length).toBeGreaterThan(0);
    });
  });

  describe('page attribution', () => {
    /**
     * Pages long enough that each fills more than one chunk, so a chunk sits wholly inside a
     * single page. With short pages the packer legitimately merges both into one chunk, which
     * tests the spanning case instead — see below.
     */
    const longPages = (): ExtractedDocument => {
      const p1 = `PAGEONE ${longProse(6)}`;
      const p2 = `PAGETWO ${longProse(6)}`;
      const text = `${p1}\n\n${p2}`;
      return doc({
        text,
        pages: [
          { number: 1, start: 0, end: p1.length },
          { number: 2, start: text.indexOf(p2), end: text.length },
        ],
      });
    };

    it('attributes a chunk wholly inside one page to that page alone', () => {
      const chunks = chunkDocument(longPages());

      const singlePage = chunks.filter((c) => c.pageFrom === c.pageTo);
      expect(singlePage.length).toBeGreaterThan(0);
      // Both pages must be represented, i.e. attribution is not just defaulting to page 1.
      expect(new Set(chunks.map((c) => c.pageFrom))).toEqual(new Set([1, 2]));
    });

    it('reports a range when a chunk spans a page break', () => {
      // Two short pages pack into one chunk, which genuinely covers both — a citation for it
      // should say "pp. 1-2" rather than silently claiming one page.
      const p1 = 'Page one sentence about intent.';
      const p2 = 'Page two sentence about plans.';
      const text = `${p1}\n\n${p2}`;
      const chunks = chunkDocument(
        doc({
          text,
          pages: [
            { number: 1, start: 0, end: p1.length },
            { number: 2, start: text.indexOf(p2), end: text.length },
          ],
        }),
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].pageFrom).toBe(1);
      expect(chunks[0].pageTo).toBe(2);
    });

    it('uses zero rather than null when the format has no pages', () => {
      // Zero is what a citation renderer reads as "not paginated"; a null would risk rendering
      // "p. null" to a worker.
      const chunks = chunkDocument(doc({ text: 'No pages here.' }));
      expect(chunks[0].pageFrom).toBe(0);
      expect(chunks[0].pageTo).toBe(0);
    });
  });

  describe('token counting', () => {
    it('uses an encoding consistent with the embedding model', () => {
      // Not a value assertion — a sanity check that encode() is wired up and roughly
      // word-scaled. A wrong encoding would silently mis-size every chunk.
      expect(countTokens('')).toBe(0);
      expect(countTokens('hello')).toBeGreaterThan(0);
      expect(countTokens(longProse(1))).toBeGreaterThan(20);
      expect(countTokens(longProse(1))).toBeLessThan(KB_CHUNK_TARGET_TOKENS);
    });
  });
});
