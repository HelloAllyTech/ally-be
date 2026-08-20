import { LanguageErrorAnnotation } from 'src/learn/entity/language-error-annotation.entity';
import { tokenize } from './variety-feature.util';

/**
 * Construct-aware extraction (the "linguistics proposes, statistics disposes"
 * layer): the judge's frozen typology is a coarse linguistic taxonomy, and
 * rule extraction should run per construct class — a lexical say/avoid pair,
 * a register correction, and an address-form rule are different kinds of
 * objects detected by different machinery. This module is the deterministic
 * half: classify annotations by construct, cluster them by evidence
 * similarity, and apply the support gate, so the LLM only ever verbalizes
 * candidates that already have statistical standing.
 */

export enum ConstructClass {
  /** Word choice: wrong regional/literary lexeme, calques, token leaks. */
  LEXICON = 'lexicon',
  /** Diglossia and formality level. */
  REGISTER = 'register',
  /** Social language: address forms, bluntness, persona voice. */
  PRAGMATICS = 'pragmatics',
  /** Systematic grammatical patterns (admitted only via the systematicity gate). */
  MORPHOSYNTAX = 'morphosyntax',
}

/** dimension → construct class. Categories refine within a dimension but the
 * judge's dimensions already partition cleanly at this granularity. */
const DIMENSION_TO_CONSTRUCT: Record<string, ConstructClass> = {
  dialect_lexicon: ConstructClass.LEXICON,
  colloquialness: ConstructClass.LEXICON,
  codeswitch: ConstructClass.LEXICON,
  register: ConstructClass.REGISTER,
  persona_social: ConstructClass.PRAGMATICS,
  fluency: ConstructClass.MORPHOSYNTAX,
};

export function constructClassOf(dimension: string): ConstructClass | null {
  return DIMENSION_TO_CONSTRUCT[dimension] ?? null;
}

/**
 * Systematicity gate for grammar: fluency errors are model competence, not
 * glossary-able — EXCEPT when the same category recurs enough to be a
 * correctable pattern (the typology's own `pattern_systemic` idea, applied
 * statistically). Returns the fluency annotations that clear the bar.
 */
export function systematicFluency(
  annotations: LanguageErrorAnnotation[],
  minSupport: number,
): LanguageErrorAnnotation[] {
  const byCategory = new Map<string, LanguageErrorAnnotation[]>();
  for (const a of annotations) {
    if (a.dimension !== 'fluency') continue;
    const list = byCategory.get(a.category) ?? [];
    list.push(a);
    byCategory.set(a.category, list);
  }
  const systemic: LanguageErrorAnnotation[] = [];
  for (const list of byCategory.values()) {
    if (list.length >= minSupport) systemic.push(...list);
  }
  return systemic;
}

export interface AnnotationCluster {
  constructClass: ConstructClass;
  category: string;
  /** 1-based indexes into the ORIGINAL annotation list — the LLM cites these
   * as sourceAnnotationIndexes, so numbering must survive clustering. */
  indexes: number[];
  support: number;
  tenants: string[];
  /** Representative evidence quotes (deduped, capped). */
  quotes: string[];
}

const QUOTE_SIMILARITY_THRESHOLD = 0.5;
const MAX_QUOTES_PER_CLUSTER = 3;

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Greedy evidence clustering within (constructClass, category): two
 * annotations join the same cluster when their evidence quotes share tokens
 * (Jaccard ≥ 0.5) — i.e. the judge flagged the same word/phrase — or when
 * neither carries a quote (category-only evidence). Deterministic, order-
 * stable, no model call.
 */
export function clusterAnnotations(
  annotations: LanguageErrorAnnotation[],
): AnnotationCluster[] {
  const clusters: (AnnotationCluster & { tokenSets: Set<string>[] })[] = [];

  annotations.forEach((annotation, i) => {
    const cls = constructClassOf(annotation.dimension);
    if (!cls) return;
    const tokens = new Set(tokenize(annotation.evidenceQuote ?? ''));
    const home = clusters.find(
      (c) =>
        c.constructClass === cls &&
        c.category === annotation.category &&
        (tokens.size === 0
          ? c.tokenSets.every((s) => s.size === 0)
          : c.tokenSets.some(
              (s) => jaccard(tokens, s) >= QUOTE_SIMILARITY_THRESHOLD,
            )),
    );
    const quote = (annotation.evidenceQuote ?? '').trim();
    if (home) {
      home.indexes.push(i + 1);
      home.support++;
      if (annotation.tenantId && !home.tenants.includes(annotation.tenantId)) {
        home.tenants.push(annotation.tenantId);
      }
      if (
        quote &&
        home.quotes.length < MAX_QUOTES_PER_CLUSTER &&
        !home.quotes.includes(quote)
      ) {
        home.quotes.push(quote);
      }
      home.tokenSets.push(tokens);
    } else {
      clusters.push({
        constructClass: cls,
        category: annotation.category,
        indexes: [i + 1],
        support: 1,
        tenants: annotation.tenantId ? [annotation.tenantId] : [],
        quotes: quote ? [quote] : [],
        tokenSets: [tokens],
      });
    }
  });

  return clusters.map((c) => {
    const { tokenSets, ...cluster } = c;
    void tokenSets;
    return cluster;
  });
}

/**
 * The support gate: clusters below `minSupport` are dropped BEFORE the LLM —
 * no single-anecdote rules. Adaptive floor: thin corpora (few annotations
 * overall) keep singletons so low-traffic languages don't stall; once a
 * language produces real volume the bar rises.
 */
export function applySupportGate(
  clusters: AnnotationCluster[],
  totalAnnotations: number,
  minSupport: number,
): AnnotationCluster[] {
  const effectiveMin = totalAnnotations >= 20 ? minSupport : 1;
  return clusters.filter((c) => c.support >= effectiveMin);
}

/**
 * Construct-grouped listing for the consolidation prompt: clusters ordered by
 * support (strongest evidence first) under construct headers, each carrying
 * its support count, tenant breadth and representative quotes. The LLM's job
 * shrinks to VERBALIZING candidates that already earned statistical standing
 * — it no longer decides what counts as evidence.
 */
export function summarizeClusters(
  clusters: AnnotationCluster[],
  annotations: LanguageErrorAnnotation[],
): string {
  const byClass = new Map<ConstructClass, AnnotationCluster[]>();
  for (const cluster of clusters) {
    const list = byClass.get(cluster.constructClass) ?? [];
    list.push(cluster);
    byClass.set(cluster.constructClass, list);
  }

  const blocks: string[] = [];
  for (const [cls, list] of byClass) {
    const lines = list
      .sort((a, b) => b.support - a.support)
      .map((cluster) => {
        const sample = annotations[cluster.indexes[0] - 1];
        const reasoning = (sample?.reasoning ?? '').slice(0, 200);
        return (
          `- [${cluster.category}] support=${cluster.support} ` +
          `orgs=${cluster.tenants.length} annotations=#${cluster.indexes.join(',#')}\n` +
          (cluster.quotes.length
            ? `  evidence: ${cluster.quotes.map((q) => `"${q}"`).join(' · ')}\n`
            : '') +
          (reasoning ? `  judge: ${reasoning}\n` : '') +
          (sample?.aiText ? `  agent said: ${sample.aiText.slice(0, 160)}` : '')
        );
      });
    blocks.push(
      `## ${cls.toUpperCase()} candidates (emit ${entryTemplateFor(cls)})\n${lines.join('\n')}`,
    );
  }
  return blocks.join('\n\n');
}

/** Entry shape per construct — lexicon wants pairs, the rest want rules. */
function entryTemplateFor(cls: ConstructClass): string {
  switch (cls) {
    case ConstructClass.LEXICON:
      return 'say/avoid term pairs: `- <english>: say "<native>" (avoid: "<native>")`';
    case ConstructClass.REGISTER:
      return 'register rules with one native-script example each';
    case ConstructClass.PRAGMATICS:
      return 'social-language rules (address forms, softening) with one example';
    case ConstructClass.MORPHOSYNTAX:
      return 'a correction rule quoting the wrong and right form';
  }
}

/** Parsed say/avoid pair from an entry's markdown (lexicon-class entries). */
export interface SayAvoidPair {
  say: string | null;
  avoid: string | null;
}

/**
 * Extract the say/avoid terms a lexicon entry asserts, tolerating the quoting
 * styles the generation/consolidation prompts emit (straight quotes and
 * backticks). Returns nulls for non-lexical entries — the evidence gate then
 * treats them as not-applicable rather than failed.
 */
export function parseSayAvoid(markdown: string): SayAvoidPair {
  const nfc = markdown.normalize('NFC');
  const say =
    nfc.match(/say\s+"([^"]+)"/i)?.[1] ?? nfc.match(/say\s+`([^`]+)`/i)?.[1];
  const avoid =
    nfc.match(/avoid:?\s*"([^"]+)"/i)?.[1] ??
    nfc.match(/avoid:?\s*`([^`]+)`/i)?.[1];
  return { say: say?.trim() || null, avoid: avoid?.trim() || null };
}

/** Occurrences of a (possibly multi-word, possibly slash-separated) term. */
export function countOccurrences(corpus: string, term: string): number {
  // Slash-separated alternatives ("depression / மன அழுத்தம்") count each.
  const alternatives = term
    .split('/')
    .map((t) => t.trim().normalize('NFC'))
    .filter((t) => t.length >= 2);
  let count = 0;
  for (const alt of alternatives) {
    let idx = corpus.indexOf(alt);
    while (idx !== -1) {
      count++;
      idx = corpus.indexOf(alt, idx + alt.length);
    }
  }
  return count;
}

export type LexicalVerdict = 'confirmed' | 'unverified' | 'contradicted';

export interface LexicalEvidence extends SayAvoidPair {
  sayLearnerCount: number;
  avoidAgentCount: number;
  avoidLearnerCount: number;
  verdict: LexicalVerdict;
}

/**
 * The distributional gate (statistics disposes): a say/avoid pair must be
 * consistent with how the population and the agent actually talk.
 * - contradicted: learners themselves use the avoid-term freely — the judge
 *   (or the LLM) is fighting the population's real usage. Never auto-accept.
 * - confirmed: the avoid-term is attested in agent speech (that's what got
 *   flagged) or the say-term is attested in learner speech.
 * - unverified: no corpus signal either way (rare word, thin corpus) — kept,
 *   but marked so review and attribution treat it as weaker.
 */
export function scoreLexicalEvidence(
  markdown: string,
  learnerCorpus: string,
  agentCorpus: string,
  contradictionMin: number,
): LexicalEvidence | null {
  const { say, avoid } = parseSayAvoid(markdown);
  if (!say && !avoid) return null;
  const sayLearnerCount = say ? countOccurrences(learnerCorpus, say) : 0;
  const avoidAgentCount = avoid ? countOccurrences(agentCorpus, avoid) : 0;
  const avoidLearnerCount = avoid ? countOccurrences(learnerCorpus, avoid) : 0;
  const verdict: LexicalVerdict =
    avoid && avoidLearnerCount >= contradictionMin
      ? 'contradicted'
      : sayLearnerCount > 0 || avoidAgentCount > 0
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
