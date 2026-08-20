import {
  addressFormStats,
  codeMixStats,
  discourseMarkerStats,
  extractVarietyFeatures,
  profileSimilarity,
  PROFILE_MATCH_THRESHOLD,
  tokenCounts,
  tokenize,
  topFrequencyLexemes,
  weightedLogOdds,
} from '../variety-feature.util';

describe('variety-feature.util', () => {
  describe('tokenize', () => {
    it('extracts Indic and Latin tokens, dropping punctuation and digits', () => {
      expect(tokenize('சரி sir, 100% ஓகே!')).toEqual(['சரி', 'sir', 'ஓகே']);
    });

    it('NFC-normalizes so decomposed and composed forms match', () => {
      const composed = 'கா'; // U+0B95 U+0BBE
      expect(tokenize(composed.normalize('NFD'))).toEqual([composed]);
    });
  });

  describe('codeMixStats', () => {
    it('measures Latin share at char and token level', () => {
      const stats = codeMixStats(['நீங்க tension ஆகாதீங்க', 'சரி ok']);
      // 2 pure-Latin tokens ("tension", "ok") of 5 tokens.
      expect(stats.latinTokenShare).toBeCloseTo(2 / 5);
      expect(stats.latinCharShare).toBeGreaterThan(0);
      expect(stats.latinCharShare).toBeLessThan(1);
    });

    it('returns zeros on an empty corpus', () => {
      expect(codeMixStats([])).toEqual({
        latinCharShare: 0,
        latinTokenShare: 0,
      });
    });
  });

  describe('addressFormStats', () => {
    it('classifies Tamil T–V forms by register', () => {
      const stats = addressFormStats(
        ['நீங்க சொல்லுங்க', 'நீ வா', 'உங்க வீடு எங்க'],
        'ta-IN',
      );
      expect(stats.formal).toBe(2); // நீங்க, உங்க
      expect(stats.informal).toBe(1); // நீ
      expect(stats.formalShare).toBeCloseTo(2 / 3);
    });

    it('returns null formalShare when no address forms observed', () => {
      expect(addressFormStats(['வணக்கம்'], 'ta-IN').formalShare).toBeNull();
    });

    it('is empty for languages without an inventory', () => {
      const stats = addressFormStats(['you should rest'], 'en-IN');
      expect(stats.formalShare).toBeNull();
      expect(stats.counts).toEqual({});
    });
  });

  describe('discourseMarkerStats', () => {
    it('counts markers per thousand tokens', () => {
      const stats = discourseMarkerStats(['சரி சரி வணக்கம் நல்லது'], 'ta-IN');
      expect(stats.counts['சரி']).toBe(2);
      expect(stats.perThousandTokens).toBeCloseTo(500);
    });
  });

  describe('weightedLogOdds', () => {
    const corpus = (pairs: [string, number][]) => new Map(pairs);

    it('surfaces tokens over-represented in A, not shared high-frequency ones', () => {
      const a = corpus([
        ['ஷுகர்', 40],
        ['சரி', 100],
      ]);
      const b = corpus([
        ['ஷுகர்', 2],
        ['சரி', 110],
        ['மருந்து', 50],
      ]);
      const result = weightedLogOdds(a, b);
      expect(result[0].token).toBe('ஷுகர்');
      // 'சரி' is common to both — must rank below the distinctive term (or be absent).
      const shared = result.find((r) => r.token === 'சரி');
      expect(shared ? shared.z! < result[0].z! : true).toBe(true);
    });

    it('drops tokens below minCount and B-leaning tokens', () => {
      const a = corpus([
        ['rare', 2],
        ['common', 10],
      ]);
      const b = corpus([['common', 100]]);
      const tokens = weightedLogOdds(a, b, { minCount: 5 }).map((r) => r.token);
      expect(tokens).not.toContain('rare'); // below support
      expect(tokens).not.toContain('common'); // leans B
    });

    it('returns empty without a contrast corpus', () => {
      expect(weightedLogOdds(corpus([['x', 10]]), new Map())).toEqual([]);
    });
  });

  describe('extractVarietyFeatures', () => {
    const turns = Array.from(
      { length: 20 },
      () => 'நீங்க சரி சொல்லுங்க டாக்டர்',
    );

    it('uses log-odds when a contrast corpus exists, frequency otherwise', () => {
      const contrast = Array.from(
        { length: 20 },
        () => 'நீ வா மருந்து சாப்பிடு',
      );
      const withContrast = extractVarietyFeatures(turns, 'ta-IN', contrast);
      expect(withContrast.characteristicLexemes.method).toBe('log_odds');
      const without = extractVarietyFeatures(turns, 'ta-IN', null);
      expect(without.characteristicLexemes.method).toBe('frequency');
      expect(without.turnStats.turns).toBe(20);
      expect(without.turnStats.avgTokensPerTurn).toBeCloseTo(4);
    });
  });

  describe('profileSimilarity', () => {
    const features = (
      lexemes: string[],
      formalShare: number | null,
      latinTokenShare = 0.01,
    ) => ({
      codeMix: { latinCharShare: latinTokenShare, latinTokenShare },
      addressForms: {
        counts: {},
        informal: formalShare === null ? 0 : 10,
        formal: formalShare === null ? 0 : 10,
        formalShare,
      },
      discourseMarkers: { counts: {}, perThousandTokens: 5 },
      turnStats: { turns: 100, avgTokensPerTurn: 10 },
      characteristicLexemes: {
        method: 'log_odds' as const,
        items: lexemes.map((token) => ({ token, count: 10, z: 3 })),
      },
    });

    it('scores identical profiles at 1 and disjoint ones low', () => {
      const a = features(['ஷுகர்', 'டென்ஷன்'], 0.8);
      expect(profileSimilarity(a, a)).toBeCloseTo(1);
      const b = features(['ಬಿಪಿ', 'ಮಾತ್ರೆ'], 0.1, 0.15);
      expect(profileSimilarity(a, b)).toBeLessThan(PROFILE_MATCH_THRESHOLD);
    });

    it('redistributes address weight when either side lacks observations', () => {
      const a = features(['x', 'y'], null);
      const b = features(['x', 'y'], 0.9);
      // Same lexemes + same code-mix → high similarity despite missing address data.
      expect(profileSimilarity(a, b)).toBeGreaterThan(0.9);
    });
  });

  describe('topFrequencyLexemes', () => {
    it('orders by count with a support floor', () => {
      const counts = tokenCounts([
        'சரி சரி சரி சரி சரி மருந்து மருந்து மருந்து மருந்து மருந்து மருந்து வா',
      ]);
      const top = topFrequencyLexemes(counts, { minCount: 5 });
      expect(top.map((t) => t.token)).toEqual(['மருந்து', 'சரி']);
    });
  });
});
