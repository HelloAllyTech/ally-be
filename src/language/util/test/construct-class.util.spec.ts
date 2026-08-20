import {
  applySupportGate,
  clusterAnnotations,
  ConstructClass,
  constructClassOf,
  countOccurrences,
  parseSayAvoid,
  scoreLexicalEvidence,
  summarizeClusters,
  systematicFluency,
} from '../construct-class.util';

const annotation = (over: Record<string, unknown>) =>
  ({
    id: 'a',
    tenantId: 't1',
    dimension: 'dialect_lexicon',
    category: 'wrong_regional_variety',
    severity: 'major',
    evidenceQuote: 'பதட்டம்',
    ...over,
  }) as any;

describe('construct-class.util', () => {
  describe('constructClassOf', () => {
    it('maps judge dimensions onto construct classes', () => {
      expect(constructClassOf('dialect_lexicon')).toBe(ConstructClass.LEXICON);
      expect(constructClassOf('register')).toBe(ConstructClass.REGISTER);
      expect(constructClassOf('persona_social')).toBe(
        ConstructClass.PRAGMATICS,
      );
      expect(constructClassOf('fluency')).toBe(ConstructClass.MORPHOSYNTAX);
      expect(constructClassOf('understanding')).toBeNull();
    });
  });

  describe('systematicFluency', () => {
    it('admits grammar errors only when the same category recurs enough', () => {
      const grammar = Array.from({ length: 5 }, (_, i) =>
        annotation({ id: `g${i}`, dimension: 'fluency', category: 'grammar' }),
      );
      const oneOff = annotation({
        id: 'x',
        dimension: 'fluency',
        category: 'unnatural_syntax',
      });
      const passed = systematicFluency([...grammar, oneOff], 5);
      expect(passed).toHaveLength(5);
      expect(passed.every((a: any) => a.category === 'grammar')).toBe(true);
    });
  });

  describe('clusterAnnotations', () => {
    it('groups same-category annotations with overlapping evidence quotes', () => {
      const clusters = clusterAnnotations([
        annotation({ id: 'a1', evidenceQuote: 'பதட்டம்' }),
        annotation({
          id: 'a2',
          evidenceQuote: 'பதட்டம் உள்ளதா',
          tenantId: 't2',
        }),
        annotation({ id: 'a3', evidenceQuote: 'மனச்சோர்வு' }),
      ]);
      // Jaccard of {பதட்டம்} vs {பதட்டம், உள்ளதா} = 1/2 ≥ 0.5 → same cluster.
      expect(clusters).toHaveLength(2);
      const big = clusters.find((c) => c.support === 2)!;
      expect(big.indexes).toEqual([1, 2]);
      expect(big.tenants.sort()).toEqual(['t1', 't2']);
      expect(big.quotes.length).toBeGreaterThan(0);
    });

    it('never merges across categories or construct classes', () => {
      const clusters = clusterAnnotations([
        annotation({ id: 'a1' }),
        annotation({
          id: 'a2',
          dimension: 'register',
          category: 'too_formal_diglossia',
        }),
      ]);
      expect(clusters).toHaveLength(2);
      expect(new Set(clusters.map((c) => c.constructClass)).size).toBe(2);
    });

    it('skips dimensions outside the construct taxonomy', () => {
      expect(
        clusterAnnotations([annotation({ dimension: 'understanding' })]),
      ).toHaveLength(0);
    });
  });

  describe('applySupportGate', () => {
    const singleton = {
      constructClass: ConstructClass.LEXICON,
      category: 'c',
      indexes: [1],
      support: 1,
      tenants: ['t1'],
      quotes: [],
    };

    it('drops singletons once the corpus has volume', () => {
      expect(applySupportGate([singleton], 25, 2)).toHaveLength(0);
    });

    it('keeps singletons for thin corpora so low-traffic languages advance', () => {
      expect(applySupportGate([singleton], 5, 2)).toHaveLength(1);
    });
  });

  describe('summarizeClusters', () => {
    it('groups by construct with support counts and per-class entry templates', () => {
      const annos = [
        annotation({
          id: 'a1',
          reasoning: 'Literary term.',
          aiText: 'உங்களுக்கு பதட்டம்?',
        }),
        annotation({
          id: 'a2',
          dimension: 'register',
          category: 'too_formal_diglossia',
        }),
      ];
      const text = summarizeClusters(clusterAnnotations(annos), annos);
      expect(text).toContain('## LEXICON candidates');
      expect(text).toContain('## REGISTER candidates');
      expect(text).toContain('support=1');
      expect(text).toContain('annotations=#1');
      expect(text).toContain('say/avoid term pairs');
    });
  });

  describe('parseSayAvoid', () => {
    it('parses both quoting styles', () => {
      expect(
        parseSayAvoid('- anxiety: say "டென்ஷன்" (avoid: "பதட்டம்")'),
      ).toEqual({
        say: 'டென்ஷன்',
        avoid: 'பதட்டம்',
      });
      expect(parseSayAvoid('- go: say `போ` avoid `செல்`').say).toBe('போ');
    });

    it('returns nulls for non-lexical rules', () => {
      expect(parseSayAvoid('- Keep sentences short.')).toEqual({
        say: null,
        avoid: null,
      });
    });
  });

  describe('countOccurrences', () => {
    it('counts each slash-separated alternative', () => {
      expect(
        countOccurrences(
          'டென்ஷன் இருக்கு டென்ஷன் tension',
          'டென்ஷன் / tension',
        ),
      ).toBe(3);
    });
  });

  describe('scoreLexicalEvidence', () => {
    const learner = 'எனக்கு டென்ஷன் ஆகுது டாக்டர்';
    const agent = 'உங்களுக்கு பதட்டம் உள்ளதா';

    it('confirms a pair attested by the corpora', () => {
      const e = scoreLexicalEvidence(
        '- anxiety: say "டென்ஷன்" (avoid: "பதட்டம்")',
        learner,
        agent,
        5,
      )!;
      expect(e.verdict).toBe('confirmed');
      expect(e.sayLearnerCount).toBe(1);
      expect(e.avoidAgentCount).toBe(1);
    });

    it('contradicts an avoid-term the population itself uses freely', () => {
      const learnerHeavy = Array(6).fill('பதட்டம்').join(' ');
      const e = scoreLexicalEvidence(
        '- anxiety: say "டென்ஷன்" (avoid: "பதட்டம்")',
        learnerHeavy,
        agent,
        5,
      )!;
      expect(e.verdict).toBe('contradicted');
    });

    it('marks pairs with no corpus signal unverified, and skips non-lexical rules', () => {
      const e = scoreLexicalEvidence(
        '- rare: say "அரிதானச்சொல்" (avoid: "வேறரிதுசொல்")',
        learner,
        agent,
        5,
      )!;
      expect(e.verdict).toBe('unverified');
      expect(
        scoreLexicalEvidence('- Keep it short.', learner, agent, 5),
      ).toBeNull();
    });
  });
});
