/**
 * Bookish-word mining: which words does the role-play AGENT say that the
 * population it imitates does not?
 *
 * The judge-annotation loop (construct-class.util) only learns from errors a
 * judge happened to flag. This is the open-vocabulary complement: compare the
 * agent's own word frequencies against the counsellors' (learners') speech in
 * the same language and surface the words the agent over-uses — literary
 * forms, formal vocabulary, translated-sounding choices. An LLM then pairs each
 * candidate with its colloquial equivalent (glossary_lexeme_pairing prompt).
 *
 * Two contaminations shape the counts, both measured in prod 2026-09-25:
 *
 *  - ECHO. Counsellors repeat the agent's words back ("you said तनाव…").
 *    23–36% of learner uses of agent-leaning words were words the agent had
 *    introduced earlier in the same session, vs 2.5–8% for counsellor-leaning
 *    words — the echo lands exactly where this miner looks, and makes the
 *    agent's bookish words look like population vocabulary (Hindi तनाव: 24 of
 *    24 learner uses came after the agent said it). So a learner occurrence
 *    counts only when the learner used the word before the agent did.
 *  - SCENARIO-BOUND WORDS. Persona names and scenario topic nouns are
 *    agent-leaning by construction (the client talks about their own life),
 *    and are 100% echoed. A register problem recurs across scenarios; a name
 *    does not — so candidates must appear in several distinct scenarios.
 *
 * Deliberately NO stopword filter: the highest-value Tamil finds are function
 * words in their literary form (அதனால், இருக்கிறேன்) — a stoplist would delete
 * exactly them. Log-odds with an informative prior already discounts words
 * both sides use at similar rates.
 */
import type { LexicalEvidence } from './construct-class.util';
import { tokenize, weightedLogOdds } from './variety-feature.util';

export interface MiningTurn {
  role: 'agent' | 'learner';
  text: string;
}

export interface MiningSession {
  sessionId: string;
  scenarioId: string | number | null;
  turns: MiningTurn[];
}

export interface LexemeCandidate {
  token: string;
  /** Agent occurrences. */
  agentCount: number;
  /** Learner occurrences after removing echoes of the agent. */
  learnerCount: number;
  /** Learner occurrences that were echoes (agent said it first in-session). */
  learnerEchoCount: number;
  /** Distinct scenarios the agent used it in. */
  scenarioSpread: number;
  /** Distinct sessions the agent used it in. */
  sessionSpread: number;
  /** Log-odds z-score, agent vs de-echoed learner speech. */
  z: number;
  /** Up to `contextsPerCandidate` agent snippets showing the word in use. */
  contexts: string[];
}

export interface LexemeMiningOptions {
  topK?: number;
  /** Minimum agent occurrences (log-odds `minCount`). */
  minAgentCount?: number;
  /** Minimum distinct scenarios the agent used the word in. */
  minScenarios?: number;
  minSessions?: number;
  /** Words already mentioned anywhere in the glossary — handled, skip. */
  excludeTokens?: Iterable<string>;
  contextsPerCandidate?: number;
  /** Size of the returned learner high-frequency lexicon. */
  lexiconSize?: number;
}

export interface LexemeMiningResult {
  candidates: LexemeCandidate[];
  /** The population's most frequent (de-echoed) words — the "say this"
   * vocabulary the pairing step draws on. */
  learnerLexicon: { token: string; count: number }[];
  /** De-echoed learner text and agent text, for the lexical evidence gate. */
  corpora: { learner: string; agent: string };
  /** Whole-word counts (learner de-echoed), for {@link scoreTokenEvidence}. */
  tokenCounts: { learner: Map<string, number>; agent: Map<string, number> };
  stats: {
    sessions: number;
    agentTokens: number;
    learnerTokens: number;
    learnerEchoTokens: number;
    /** Share of learner uses of agent-leaning words that were echoes. */
    agentLeaningEchoShare: number | null;
    droppedScenarioBound: number;
    droppedAlreadyInGlossary: number;
  };
}

const inc = (m: Map<string, number>, k: string, n = 1) =>
  m.set(k, (m.get(k) ?? 0) + n);

function addTo(m: Map<string, Set<string>>, k: string, v: string) {
  const set = m.get(k) ?? new Set<string>();
  set.add(v);
  m.set(k, set);
}

/**
 * Remove bracketed stage directions (`[pause]`, `[sighs]`, `[long pause]`)
 * before counting. The agent emits them as TTS audio tags and the stored
 * transcript keeps them, so unstripped they top every agent-leaning list —
 * the first prod dry run (2026-09-25) "paired" `pause` with a Hindi filler.
 */
export function stripStageDirections(text: string): string {
  return (text ?? '').replace(/\[[^\]\n]{1,40}\]/g, ' ');
}

/** A snippet around the first occurrence of `token`, on word boundaries. */
function snippet(text: string, token: string, width = 120): string | null {
  const flat = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  const idx = flat.toLowerCase().indexOf(token);
  if (idx === -1) return null;
  const half = Math.floor((width - token.length) / 2);
  let start = Math.max(0, idx - half);
  let end = Math.min(flat.length, idx + token.length + half);
  if (start > 0) start = flat.indexOf(' ', start) + 1 || start;
  if (end < flat.length) end = flat.lastIndexOf(' ', end) || end;
  return (
    (start > 0 ? '…' : '') +
    flat.slice(start, end).trim() +
    (end < flat.length ? '…' : '')
  );
}

export function mineBookishLexemes(
  sessions: MiningSession[],
  opts: LexemeMiningOptions = {},
): LexemeMiningResult {
  const {
    topK = 40,
    minAgentCount = 5,
    minScenarios = 3,
    minSessions = 3,
    contextsPerCandidate = 2,
    lexiconSize = 60,
  } = opts;
  const exclude = new Set(
    [...(opts.excludeTokens ?? [])].map((t) =>
      t.normalize('NFC').toLowerCase(),
    ),
  );

  const agentCounts = new Map<string, number>();
  const learnerCounts = new Map<string, number>(); // de-echoed
  const echoCounts = new Map<string, number>();
  const scenariosByToken = new Map<string, Set<string>>();
  const sessionsByToken = new Map<string, Set<string>>();
  const contexts = new Map<string, string[]>();
  const learnerText: string[] = [];
  const agentText: string[] = [];

  for (const session of sessions) {
    const scenarioKey = String(session.scenarioId ?? session.sessionId);
    const learnerSaid = new Set<string>();
    // Words the agent introduced: said by the agent before the learner ever
    // used them in this session. Only these can be echoed.
    const agentIntroduced = new Set<string>();

    for (const turn of session.turns) {
      const text = stripStageDirections(turn.text);
      const tokens = tokenize(text);
      if (turn.role === 'agent') {
        agentText.push(text.normalize('NFC'));
        for (const t of tokens) {
          inc(agentCounts, t);
          if (!learnerSaid.has(t)) agentIntroduced.add(t);
          addTo(scenariosByToken, t, scenarioKey);
          addTo(sessionsByToken, t, session.sessionId);
          const ctx = contexts.get(t) ?? [];
          if (ctx.length < contextsPerCandidate) {
            const s = snippet(text, t);
            if (s && !ctx.includes(s)) contexts.set(t, [...ctx, s]);
          }
        }
        continue;
      }
      const kept: string[] = [];
      for (const t of tokens) {
        if (agentIntroduced.has(t)) {
          inc(echoCounts, t);
        } else {
          inc(learnerCounts, t);
          kept.push(t);
        }
        learnerSaid.add(t);
      }
      if (kept.length) learnerText.push(kept.join(' '));
    }
  }

  const sum = (m: Map<string, number>) =>
    [...m.values()].reduce((s, c) => s + c, 0);

  // Rank generously, then filter: dropped rows must not starve the topK.
  const ranked = weightedLogOdds(agentCounts, learnerCounts, {
    topK: Number.MAX_SAFE_INTEGER,
    minCount: minAgentCount,
  });

  let droppedScenarioBound = 0;
  let droppedAlreadyInGlossary = 0;
  const candidates: LexemeCandidate[] = [];
  for (const row of ranked) {
    if (candidates.length >= topK) break;
    if ([...row.token].length < 2) continue;
    if (exclude.has(row.token)) {
      droppedAlreadyInGlossary++;
      continue;
    }
    const scenarioSpread = scenariosByToken.get(row.token)?.size ?? 0;
    const sessionSpread = sessionsByToken.get(row.token)?.size ?? 0;
    if (scenarioSpread < minScenarios || sessionSpread < minSessions) {
      droppedScenarioBound++;
      continue;
    }
    candidates.push({
      token: row.token,
      agentCount: row.count,
      learnerCount: learnerCounts.get(row.token) ?? 0,
      learnerEchoCount: echoCounts.get(row.token) ?? 0,
      scenarioSpread,
      sessionSpread,
      z: Number((row.z ?? 0).toFixed(2)),
      contexts: contexts.get(row.token) ?? [],
    });
  }

  // Echo share over the agent-leaning side of the vocabulary (same measure as
  // the 2026-09-25 probe), reported so a reader can see the correction's size.
  const leaning = ranked.slice(0, 200);
  const leaningLearner = leaning.reduce(
    (s, r) =>
      s + (learnerCounts.get(r.token) ?? 0) + (echoCounts.get(r.token) ?? 0),
    0,
  );
  const leaningEcho = leaning.reduce(
    (s, r) => s + (echoCounts.get(r.token) ?? 0),
    0,
  );

  const learnerLexicon = [...learnerCounts.entries()]
    .filter(([t]) => [...t].length >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, lexiconSize)
    .map(([token, count]) => ({ token, count }));

  return {
    candidates,
    learnerLexicon,
    corpora: { learner: learnerText.join('\n'), agent: agentText.join('\n') },
    tokenCounts: { learner: learnerCounts, agent: agentCounts },
    stats: {
      sessions: sessions.length,
      agentTokens: sum(agentCounts),
      learnerTokens: sum(learnerCounts),
      learnerEchoTokens: sum(echoCounts),
      agentLeaningEchoShare: leaningLearner
        ? Number((leaningEcho / leaningLearner).toFixed(3))
        : null,
      droppedScenarioBound,
      droppedAlreadyInGlossary,
    },
  };
}

/** Word classes the pairing prompt assigns. */
export const LEXEME_WORD_CLASSES = [
  'discourse_marker',
  'conjunction',
  'lexeme',
  'verb_form',
  'pronoun_address',
  'other',
] as const;
export type LexemeWordClass = (typeof LEXEME_WORD_CLASSES)[number];

/**
 * Could this pair be swapped mechanically in the agent's output stream,
 * without breaking the sentence? Only when nothing else in the sentence has to
 * agree with the word: a single token on both sides, of a class that carries
 * no agreement. Address forms and pronouns never qualify — Hindi आप→तुम also
 * requires हैं→हो on the verb, so a word swap produces broken grammar — and
 * neither do verb forms, whose colloquial variant is morphology, not a word.
 */
export function isSwapSafe(
  wordClass: string,
  avoid: string,
  say: string,
  addressForms: Iterable<string> = [],
): boolean {
  if (!['discourse_marker', 'conjunction', 'lexeme'].includes(wordClass)) {
    return false;
  }
  const a = tokenize(avoid);
  const s = tokenize(say);
  if (a.length !== 1 || s.length !== 1) return false;
  const address = new Set([...addressForms].map((f) => f.normalize('NFC')));
  return !address.has(a[0]) && !address.has(s[0]);
}

/**
 * The lexical evidence gate's verdict, counted on WHOLE WORDS rather than
 * substrings, for a single-word pair. construct-class's `scoreLexicalEvidence`
 * counts substrings, which in agglutinative languages counts the wrong thing
 * both ways: colloquial `சரியா` is a prefix of literary `சரியாக`, so every
 * literary use also counted as the colloquial form, and `மாலை` matched inside
 * `மாலையில்`. Same contradiction rule; null when either side is not a
 * single word (the caller falls back to the substring scorer).
 *
 * `confirmed` means the counsellors actually SAY the replacement. The
 * consolidation scorer also confirms on "the agent says the avoid-term", which
 * is true of every mined candidate by construction — so on the first prod dry
 * runs every uncontradicted pair read `confirmed`, including மாலை→சாயங்காலம்
 * whose replacement no counsellor had ever said.
 */
export function scoreTokenEvidence(
  say: string,
  avoid: string,
  counts: { learner: Map<string, number>; agent: Map<string, number> },
  contradictionMin: number,
): LexicalEvidence | null {
  const sayTokens = tokenize(say);
  const avoidTokens = tokenize(avoid);
  if (sayTokens.length !== 1 || avoidTokens.length !== 1) return null;
  const sayLearnerCount = counts.learner.get(sayTokens[0]) ?? 0;
  const avoidLearnerCount = counts.learner.get(avoidTokens[0]) ?? 0;
  const avoidAgentCount = counts.agent.get(avoidTokens[0]) ?? 0;
  const total = sayLearnerCount + avoidLearnerCount;
  const avoidShare = total > 0 ? avoidLearnerCount / total : 0;
  const verdict =
    avoidLearnerCount >= contradictionMin && avoidShare >= 0.2
      ? 'contradicted'
      : sayLearnerCount > 0
        ? 'confirmed'
        : 'unverified';
  return {
    say,
    avoid,
    sayLearnerCount,
    avoidAgentCount,
    avoidLearnerCount,
    verdict,
  };
}
