import { KnowledgeCitation } from 'src/ai/dto/knowledge.dto';
import { composeReply } from '../reply-composer';

/**
 * The composer produces the literal bytes a mental healthcare worker receives. Its failure modes are
 * all quiet ones: a half-rendered citation that cannot be looked up, a truncated qualification that
 * inverts the meaning of what survives, or sources attached to a reply that was not grounded in them.
 */
describe('composeReply', () => {
  const citation = (over: Partial<KnowledgeCitation> = {}): KnowledgeCitation =>
    ({
      passage_number: 1,
      chunk_id: '11111111-1111-1111-1111-111111111111',
      document_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      document_title: 'WHO mhGAP Intervention Guide',
      page_from: 44,
      page_to: 44,
      section_path: 'Depression > Assessment',
      source_url: '',
      similarity: 0.61,
      ...over,
    }) as KnowledgeCitation;

  const base = {
    declineText: 'My reference material does not cover that.',
    maxAnswerChars: 1400,
    maxReplyChars: 1600,
    maxCitations: 3,
  };

  describe('answers', () => {
    it('appends a source block', () => {
      const out = composeReply({
        ...base,
        intent: 'answer',
        answer: 'Ask directly about intent and plan.',
        citations: [citation()],
      });

      expect(out).toContain('Ask directly about intent and plan.');
      expect(out).toContain('Sources:');
      expect(out).toContain('— WHO mhGAP Intervention Guide, p. 44');
    });

    it('renders a page range', () => {
      const out = composeReply({
        ...base,
        intent: 'answer',
        answer: 'x',
        citations: [citation({ page_from: 44, page_to: 46 })],
      });
      expect(out).toContain('pp. 44-46');
    });

    it('falls back to the section when there is no page', () => {
      // Every format except PDF has no pages, which is most of the corpus — without this fallback
      // those citations would name only the document title.
      const out = composeReply({
        ...base,
        intent: 'answer',
        answer: 'x',
        citations: [citation({ page_from: 0, page_to: 0 })],
      });
      expect(out).toContain('Depression > Assessment');
      expect(out).not.toContain('p. 0');
    });

    it('deduplicates two citations from the same place', () => {
      // Two chunks from one page are one source to a reader; repeating it looks like padding.
      const out = composeReply({
        ...base,
        intent: 'answer',
        answer: 'x',
        citations: [citation(), citation({ passage_number: 2 })],
      });
      expect(out.match(/— WHO mhGAP/g)).toHaveLength(1);
    });

    it('caps the number of citations', () => {
      const out = composeReply({
        ...base,
        maxCitations: 2,
        intent: 'answer',
        answer: 'x',
        citations: [
          citation({ document_title: 'A' }),
          citation({ document_title: 'B' }),
          citation({ document_title: 'C' }),
        ],
      });
      expect(out).toContain('— A');
      expect(out).toContain('— B');
      expect(out).not.toContain('— C');
    });

    it('omits the source block when there are no citations', () => {
      const out = composeReply({
        ...base,
        intent: 'answer',
        answer: 'A synthesis across passages.',
        citations: [],
      });
      expect(out).toBe('A synthesis across passages.');
      expect(out).not.toContain('Sources:');
    });

    it('skips a citation with nothing to render', () => {
      const out = composeReply({
        ...base,
        intent: 'answer',
        answer: 'x',
        citations: [
          citation({
            document_title: '',
            section_path: '',
            page_from: 0,
            page_to: 0,
          }),
        ],
      });
      expect(out).not.toContain('Sources:');
    });
  });

  describe('declines and clarifications', () => {
    it("a decline prefers the model's own sentence, which is in the worker's language", () => {
      // The answer prompt asks the model to write its decline in the language the
      // worker used. Substituting the fixed English `declineText` over the top of
      // it — which is what this did before — answered a Hindi question in English
      // on the single most common reply the bot sends.
      const out = composeReply({
        ...base,
        intent: 'decline',
        answer: 'मेरे संदर्भ सामग्री में यह जानकारी नहीं है।',
        citations: [],
      });
      expect(out).toBe('मेरे संदर्भ सामग्री में यह जानकारी नहीं है।');
    });

    it('a decline falls back to the configured wording when the model wrote nothing', () => {
      // The pre-LLM decline path (no_hits / below_threshold) never reaches a
      // model, so `answer` is empty and the admin's wording is what goes out —
      // unchanged from before.
      const out = composeReply({
        ...base,
        intent: 'decline',
        answer: '   ',
        citations: [],
      });
      expect(out).toBe(base.declineText);
    });

    it('a decline never carries sources', () => {
      // Attaching them would imply the reply was grounded in them.
      const out = composeReply({
        ...base,
        intent: 'decline',
        answer: '',
        citations: [citation()],
      });
      expect(out).not.toContain('Sources:');
    });

    it('a clarification uses the model question and carries no sources', () => {
      const out = composeReply({
        ...base,
        intent: 'clarify',
        answer: 'Which age group do you mean?',
        citations: [citation()],
      });
      expect(out).toBe('Which age group do you mean?');
    });

    it('an empty answer falls back to the decline text rather than sending nothing', () => {
      const out = composeReply({
        ...base,
        intent: 'answer',
        answer: '   ',
        citations: [],
      });
      expect(out).toBe(base.declineText);
    });
  });

  describe('length limits', () => {
    it('never exceeds maxReplyChars', () => {
      const out = composeReply({
        ...base,
        maxAnswerChars: 200,
        maxReplyChars: 260,
        intent: 'answer',
        answer: 'Sentence one is here. '.repeat(40),
        citations: [citation(), citation({ document_title: 'Second guide' })],
      });
      expect(out.length).toBeLessThanOrEqual(260);
    });

    it('truncates at a sentence boundary', () => {
      // Cutting mid-sentence in a clinical answer can invert the meaning of what survives — a
      // truncated "do not escalate unless" is worse than a shorter answer.
      const answer =
        'First sentence about intent. Second sentence about plan. Third sentence about means.';
      const out = composeReply({
        ...base,
        maxAnswerChars: 60,
        intent: 'answer',
        answer,
        citations: [],
      });

      expect(out.endsWith('…')).toBe(true);
      expect(out).toContain('First sentence about intent.');
      expect(out).not.toContain('Third sentence');
    });

    it('drops whole source lines rather than splitting one', () => {
      // A half-rendered citation still looks like a real reference but cannot be looked up.
      const out = composeReply({
        ...base,
        maxAnswerChars: 100,
        maxReplyChars: 150,
        intent: 'answer',
        answer: 'Short answer.',
        citations: [
          citation({
            document_title: 'A very long document title indeed here',
          }),
          citation({ document_title: 'Another very long document title here' }),
          citation({ document_title: 'A third very long document title here' }),
        ],
      });

      expect(out.length).toBeLessThanOrEqual(150);
      // Every rendered line is complete: each starts with the marker and none is cut mid-title.
      const lines = out.split('Sources:\n')[1]?.split('\n') ?? [];
      for (const line of lines) {
        expect(line.startsWith('— ')).toBe(true);
      }
    });

    it('sends the answer alone when no source line fits', () => {
      const out = composeReply({
        ...base,
        maxAnswerChars: 80,
        maxReplyChars: 90,
        intent: 'answer',
        answer: 'An answer that fills nearly the whole budget on its own here.',
        citations: [
          citation({
            document_title: 'An extremely long document title that cannot fit',
          }),
        ],
      });

      // A dangling "Sources:" header with nothing under it would look like a rendering bug.
      expect(out).not.toContain('Sources:');
      expect(out.length).toBeLessThanOrEqual(90);
    });
  });
});
