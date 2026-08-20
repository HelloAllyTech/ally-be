/**
 * Pure feature extraction for language variety profiles
 * (LANGUAGE_GLOSSARY_DESIGN.md follow-up: variety profiles, phase 1).
 *
 * A variety profile summarizes how a deployment population actually speaks,
 * computed from the LEARNER (human) side of judged-session transcripts. All
 * functions here are pure and deterministic so the statistics are unit-testable
 * without a database; the service supplies the corpora.
 *
 * Feature choices are deliberately topic-controlled: address forms and
 * discourse markers are small closed classes (they mark variety, not subject
 * matter), code-mix is script-based, and open-vocabulary comparison uses
 * weighted log-odds against the rest of the language's traffic — raw frequency
 * would just rediscover each org's domain vocabulary.
 */

/** Second-person address inventory: maps surface form → register. */
export type AddressRegister = 'informal' | 'formal';

interface LanguageInventories {
  /** T–V address forms (common inflected variants included). */
  addressForms: Record<string, AddressRegister>;
  /** Conversational discourse markers / fillers / backchannels. */
  discourseMarkers: string[];
}

/**
 * Seed closed-class inventories per language value (languages.value). These
 * are variety MARKERS, not exhaustive grammars — extend freely; every list is
 * NFC-normalized at lookup time so script variants match.
 */
const LANGUAGE_INVENTORIES: Record<string, LanguageInventories> = {
  'ta-IN': {
    addressForms: {
      நீ: 'informal',
      உன்: 'informal',
      உன்னை: 'informal',
      உனக்கு: 'informal',
      நீங்கள்: 'formal',
      நீங்க: 'formal',
      உங்கள்: 'formal',
      உங்க: 'formal',
      உங்களுக்கு: 'formal',
      உங்களை: 'formal',
    },
    discourseMarkers: ['அப்புறம்', 'சரி', 'ஆமா', 'இல்ல', 'அதான்', 'அப்போ'],
  },
  'kn-IN': {
    addressForms: {
      ನೀನು: 'informal',
      ನಿನ್ನ: 'informal',
      ನಿನಗೆ: 'informal',
      ನಿನ್ನನ್ನು: 'informal',
      ನೀವು: 'formal',
      ನಿಮ್ಮ: 'formal',
      ನಿಮಗೆ: 'formal',
      ನಿಮ್ಮನ್ನು: 'formal',
    },
    discourseMarkers: ['ಮತ್ತೆ', 'ಸರಿ', 'ಹೌದು', 'ಇಲ್ಲ', 'ಅಂದ್ರೆ', 'ಆಯ್ತು'],
  },
  'ml-IN': {
    addressForms: {
      നീ: 'informal',
      നിന്റെ: 'informal',
      നിനക്ക്: 'informal',
      നിങ്ങൾ: 'formal',
      നിങ്ങളുടെ: 'formal',
      നിങ്ങൾക്ക്: 'formal',
      താങ്കൾ: 'formal',
      താങ്കളുടെ: 'formal',
    },
    discourseMarkers: ['പിന്നെ', 'ശരി', 'അതെ', 'ഇല്ല', 'അപ്പോ', 'ആണോ'],
  },
  'hi-IN': {
    addressForms: {
      तू: 'informal',
      तेरा: 'informal',
      तुझे: 'informal',
      तुम: 'informal',
      तुम्हारा: 'informal',
      तुम्हें: 'informal',
      आप: 'formal',
      आपका: 'formal',
      आपको: 'formal',
    },
    discourseMarkers: ['अच्छा', 'ठीक', 'हाँ', 'नहीं', 'मतलब', 'तो'],
  },
  'mr-IN': {
    addressForms: {
      तू: 'informal',
      तुझा: 'informal',
      तुला: 'informal',
      तुम्ही: 'formal',
      तुमचा: 'formal',
      तुम्हाला: 'formal',
      आपण: 'formal',
      आपला: 'formal',
    },
    discourseMarkers: ['बरं', 'हो', 'नाही', 'म्हणजे', 'मग'],
  },
  'te-IN': {
    addressForms: {
      నువ్వు: 'informal',
      నీ: 'informal',
      నీకు: 'informal',
      మీరు: 'formal',
      మీ: 'formal',
      మీకు: 'formal',
    },
    discourseMarkers: ['సరే', 'అవును', 'కాదు', 'అంటే', 'మరి'],
  },
  'bn-IN': {
    addressForms: {
      তুই: 'informal',
      তোর: 'informal',
      তুমি: 'informal',
      তোমার: 'formal',
      আপনি: 'formal',
      আপনার: 'formal',
    },
    discourseMarkers: ['আচ্ছা', 'হ্যাঁ', 'না', 'মানে', 'তারপর'],
  },
};

const nfc = (s: string): string => s.normalize('NFC');

export function getLanguageInventories(
  languageValue: string,
): LanguageInventories {
  const raw = LANGUAGE_INVENTORIES[languageValue];
  if (!raw) return { addressForms: {}, discourseMarkers: [] };
  return {
    addressForms: Object.fromEntries(
      Object.entries(raw.addressForms).map(([k, v]) => [nfc(k), v]),
    ),
    discourseMarkers: raw.discourseMarkers.map(nfc),
  };
}

/** Unicode-letter tokenizer: NFC-normalized, lowercased (Latin only lowers). */
export function tokenize(text: string): string[] {
  return (
    nfc(text)
      .toLowerCase()
      .match(/[\p{L}\p{M}]+/gu) ?? []
  ).filter(Boolean);
}

export interface CodeMixStats {
  /** Latin letters over all letters — script-level code-mix proxy. */
  latinCharShare: number;
  /** Pure-Latin tokens over all tokens. */
  latinTokenShare: number;
}

export function codeMixStats(turns: string[]): CodeMixStats {
  let latinChars = 0;
  let letterChars = 0;
  let latinTokens = 0;
  let tokens = 0;
  for (const turn of turns) {
    for (const token of tokenize(turn)) {
      tokens++;
      const latin = (token.match(/[a-z]/g) ?? []).length;
      latinChars += latin;
      letterChars += token.length;
      if (latin === token.length) latinTokens++;
    }
  }
  return {
    latinCharShare: letterChars ? latinChars / letterChars : 0,
    latinTokenShare: tokens ? latinTokens / tokens : 0,
  };
}

export interface AddressFormStats {
  counts: Record<string, number>;
  informal: number;
  formal: number;
  /** formal / (formal + informal); null when no address forms were observed. */
  formalShare: number | null;
}

export function addressFormStats(
  turns: string[],
  languageValue: string,
): AddressFormStats {
  const { addressForms } = getLanguageInventories(languageValue);
  const counts: Record<string, number> = {};
  let informal = 0;
  let formal = 0;
  for (const turn of turns) {
    for (const token of tokenize(turn)) {
      const register = addressForms[token];
      if (!register) continue;
      counts[token] = (counts[token] ?? 0) + 1;
      if (register === 'informal') informal++;
      else formal++;
    }
  }
  const total = informal + formal;
  return {
    counts,
    informal,
    formal,
    formalShare: total ? formal / total : null,
  };
}

export interface DiscourseMarkerStats {
  counts: Record<string, number>;
  perThousandTokens: number;
}

export function discourseMarkerStats(
  turns: string[],
  languageValue: string,
): DiscourseMarkerStats {
  const markers = new Set(
    getLanguageInventories(languageValue).discourseMarkers,
  );
  const counts: Record<string, number> = {};
  let hits = 0;
  let tokens = 0;
  for (const turn of turns) {
    for (const token of tokenize(turn)) {
      tokens++;
      if (!markers.has(token)) continue;
      counts[token] = (counts[token] ?? 0) + 1;
      hits++;
    }
  }
  return { counts, perThousandTokens: tokens ? (hits / tokens) * 1000 : 0 };
}

export interface CharacteristicLexeme {
  token: string;
  count: number;
  /** Present when computed against a contrast corpus (weighted log-odds z). */
  z?: number;
}

export function tokenCounts(turns: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const turn of turns) {
    for (const token of tokenize(turn)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Weighted log-odds with an informative Dirichlet prior (Monroe, Colaresi &
 * Quinn 2008, "Fightin' Words"): which tokens are over-represented in corpus A
 * relative to corpus B, controlling for overall frequency? Returns the top-k
 * A-leaning tokens by z-score. The prior is the combined corpus scaled to
 * `priorMass` pseudo-counts, which shrinks rare-word estimates toward zero.
 */
export function weightedLogOdds(
  countsA: Map<string, number>,
  countsB: Map<string, number>,
  opts: { topK?: number; minCount?: number; priorMass?: number } = {},
): CharacteristicLexeme[] {
  const { topK = 30, minCount = 5, priorMass = 1000 } = opts;
  const nA = [...countsA.values()].reduce((s, c) => s + c, 0);
  const nB = [...countsB.values()].reduce((s, c) => s + c, 0);
  if (!nA || !nB) return [];

  const combined = new Map<string, number>();
  for (const [t, c] of countsA) combined.set(t, (combined.get(t) ?? 0) + c);
  for (const [t, c] of countsB) combined.set(t, (combined.get(t) ?? 0) + c);
  const nTotal = nA + nB;

  const results: CharacteristicLexeme[] = [];
  for (const [token, combinedCount] of combined) {
    const yA = countsA.get(token) ?? 0;
    if (yA < minCount) continue;
    const yB = countsB.get(token) ?? 0;
    const alpha = (combinedCount / nTotal) * priorMass;
    const alpha0 = priorMass;
    const logOddsA = Math.log((yA + alpha) / (nA + alpha0 - yA - alpha));
    const logOddsB = Math.log((yB + alpha) / (nB + alpha0 - yB - alpha));
    const delta = logOddsA - logOddsB;
    if (delta <= 0) continue;
    const variance = 1 / (yA + alpha) + 1 / (yB + alpha);
    results.push({ token, count: yA, z: delta / Math.sqrt(variance) });
  }
  return results.sort((a, b) => (b.z ?? 0) - (a.z ?? 0)).slice(0, topK);
}

/** Fallback when a language has no contrast corpus: plain top frequencies. */
export function topFrequencyLexemes(
  counts: Map<string, number>,
  opts: { topK?: number; minCount?: number } = {},
): CharacteristicLexeme[] {
  const { topK = 30, minCount = 5 } = opts;
  return [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([token, count]) => ({ token, count }));
}

/** The stored profile feature vector (jsonb `features` column). */
export interface VarietyFeatures {
  codeMix: CodeMixStats;
  addressForms: AddressFormStats;
  discourseMarkers: DiscourseMarkerStats;
  turnStats: { turns: number; avgTokensPerTurn: number };
  characteristicLexemes: {
    method: 'log_odds' | 'frequency';
    items: CharacteristicLexeme[];
  };
}

export function extractVarietyFeatures(
  turns: string[],
  languageValue: string,
  contrastTurns: string[] | null,
): VarietyFeatures {
  const counts = tokenCounts(turns);
  const totalTokens = [...counts.values()].reduce((s, c) => s + c, 0);
  const lexemes = contrastTurns?.length
    ? weightedLogOdds(counts, tokenCounts(contrastTurns))
    : topFrequencyLexemes(counts);
  return {
    codeMix: codeMixStats(turns),
    addressForms: addressFormStats(turns, languageValue),
    discourseMarkers: discourseMarkerStats(turns, languageValue),
    turnStats: {
      turns: turns.length,
      avgTokensPerTurn: turns.length ? totalTokens / turns.length : 0,
    },
    characteristicLexemes: {
      method: contrastTurns?.length ? 'log_odds' : 'frequency',
      items: lexemes,
    },
  };
}

/**
 * Similarity between two profiles' features, 0..1 — the profile-matching
 * heuristic (v1). Lexical overlap carries the most weight because it is the
 * strongest variety signal; code-mix and address register are scalar
 * closeness. When either side lacks address-form observations, that weight is
 * folded into the lexical term rather than counted as agreement.
 */
export function profileSimilarity(
  a: VarietyFeatures,
  b: VarietyFeatures,
): number {
  const setA = new Set(a.characteristicLexemes.items.map((i) => i.token));
  const setB = new Set(b.characteristicLexemes.items.map((i) => i.token));
  const union = new Set([...setA, ...setB]).size;
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const lexical = union ? intersection / union : 0;

  const codeMixCloseness =
    1 -
    Math.min(
      1,
      Math.abs(a.codeMix.latinTokenShare - b.codeMix.latinTokenShare) / 0.2,
    );

  const aFormal = a.addressForms.formalShare;
  const bFormal = b.addressForms.formalShare;
  if (aFormal === null || bFormal === null) {
    return 0.8 * lexical + 0.2 * codeMixCloseness;
  }
  const addressCloseness = 1 - Math.abs(aFormal - bFormal);
  return 0.5 * lexical + 0.2 * codeMixCloseness + 0.3 * addressCloseness;
}

/** Attach a tenant to an existing profile at or above this similarity. */
export const PROFILE_MATCH_THRESHOLD = 0.75;

/**
 * One-line target-variety descriptor for the language judge: the language's
 * base variety string sharpened with the population's measured markers, so
 * the judge scores each org's sessions against how ITS population speaks
 * rather than the platform-wide default. Deliberately short — this rides in
 * the judge's parameter block, not the rubric.
 */
export function varietyTargetDescriptor(
  base: string,
  features: VarietyFeatures,
): string {
  const parts: string[] = [];
  const { formalShare } = features.addressForms;
  if (formalShare !== null) {
    const pct = Math.round(formalShare * 100);
    parts.push(
      pct >= 70
        ? `predominantly formal address (${pct}%)`
        : pct <= 30
          ? `predominantly informal address (${100 - pct}% informal)`
          : `mixed address registers (${pct}% formal)`,
    );
  }
  const mix = features.codeMix.latinTokenShare;
  parts.push(
    mix >= 0.15
      ? `heavy English code-mix (${Math.round(mix * 100)}% Latin tokens)`
      : mix >= 0.05
        ? `moderate English code-mix`
        : `minimal English code-mix`,
  );
  const lexemes = features.characteristicLexemes.items
    .slice(0, 5)
    .map((i) => i.token);
  if (lexemes.length) {
    parts.push(`population says: ${lexemes.join(', ')}`);
  }
  return `${base} — ${parts.join('; ')}`;
}
