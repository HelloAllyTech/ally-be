import {
  GLOSSARY_NEAR_DUPLICATE_JACCARD,
  GlossaryDedupeIndex,
  normalizeMarkdown,
} from '../glossary-dedupe.util';

describe('normalizeMarkdown', () => {
  it('collapses whitespace and case', () => {
    expect(normalizeMarkdown('  Use   VaNaKkAm  ')).toBe('use vanakkam');
  });

  it('treats undefined as empty', () => {
    expect(normalizeMarkdown(undefined)).toBe('');
  });
});

describe('GlossaryDedupeIndex', () => {
  it('catches a verbatim restatement', () => {
    const index = new GlossaryDedupeIndex();
    index.add('- Use வணக்கம், not "hello".');
    expect(index.isDuplicate('- Use வணக்கம், not "hello".')).toBe(true);
  });

  it('catches a re-cased, re-spaced restatement', () => {
    const index = new GlossaryDedupeIndex();
    index.add('- Use வணக்கம், not "hello".');
    expect(index.isDuplicate('-   use வணக்கம், NOT "hello".')).toBe(true);
  });

  it('catches a re-punctuated and re-bulleted restatement', () => {
    const index = new GlossaryDedupeIndex();
    index.add('- Use வணக்கம், not "hello".');
    expect(index.isDuplicate('* Use வணக்கம் — not hello')).toBe(true);
  });

  it('indexes every line of a markdown body', () => {
    const index = new GlossaryDedupeIndex();
    index.addContent(
      '## Core style\n- Use வணக்கம்.\n\n- Avoid English fillers.',
    );
    expect(index.isDuplicate('- Use வணக்கம்.')).toBe(true);
    expect(index.isDuplicate('- Avoid English fillers.')).toBe(true);
    expect(index.size).toBe(3);
  });

  it('admits a genuinely different rule', () => {
    const index = new GlossaryDedupeIndex();
    index.add('- Use வணக்கம், not "hello".');
    expect(
      index.isDuplicate('- Address the caller as அம்மா, never by name.'),
    ).toBe(false);
  });

  // Why the signature is ordered PAIRS and not a bag of tokens: a reversal
  // shares every token with its original, so a bag scores 1.0 and no threshold
  // can separate the two. A wrongly suppressed proposal never consumes its
  // annotations, so it would be re-proposed and re-suppressed forever.
  it('does NOT collapse a rule with its reversal', () => {
    const index = new GlossaryDedupeIndex();
    index.add('- Prefer அப்பா over daddy.');
    expect(index.isDuplicate('- Prefer daddy over அப்பா.')).toBe(false);
  });

  it('treats a blank proposal as a duplicate rather than indexing it', () => {
    const index = new GlossaryDedupeIndex();
    expect(index.isDuplicate('   ')).toBe(true);
    index.add('   ');
    expect(index.size).toBe(0);
  });

  it('keeps the near-duplicate bar high enough to require near-identity', () => {
    expect(GLOSSARY_NEAR_DUPLICATE_JACCARD).toBeGreaterThanOrEqual(0.8);
  });

  // The caller's obligation differs by source: a queued sibling can simply be
  // dropped (whichever lands consumes the evidence), while a PUBLISHED match
  // means the rule is being re-derived because the published one isn't working.
  describe('match source', () => {
    it('reports a published-content match as published', () => {
      const index = new GlossaryDedupeIndex();
      index.addContent('- Use நீங்க, not நீங்கள்.');
      const match = index.duplicateOf('- Use நீங்க, not நீங்கள்.');
      expect(match?.source).toBe('published');
    });

    it('reports a queued-proposal match as a proposal', () => {
      const index = new GlossaryDedupeIndex();
      index.add('- Use நீங்க, not நீங்கள்.');
      expect(index.duplicateOf('- Use நீங்க, not நீங்கள்.')?.source).toBe(
        'proposal',
      );
    });

    it('prefers published over proposal when both match', () => {
      const index = new GlossaryDedupeIndex();
      index.add('- Prefer டென்ஷன் over பதட்டம் in casual talk.');
      index.addContent('- Prefer டென்ஷன் over பதட்டம் in casual talk!');
      // Near-identity on both; the stricter obligation must win regardless of
      // insertion order.
      expect(
        index.duplicateOf('- Prefer டென்ஷன் over பதட்டம் in casual talk')
          ?.source,
      ).toBe('published');
    });

    it('returns null for a genuinely new rule', () => {
      const index = new GlossaryDedupeIndex();
      index.addContent('- Use நீங்க, not நீங்கள்.');
      expect(index.duplicateOf('- Mother takes she-forms: அவங்க.')).toBeNull();
    });
  });
});
