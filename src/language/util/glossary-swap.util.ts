/**
 * Which published glossary rules the live agent may enforce by swapping words
 * in its own output (ally-ai-learn `app/core/agent/glossary_swap.py`).
 *
 * The prompt already asks the agent to follow every published rule; a swap
 * only guarantees the outcome for the rules where a mechanical word swap
 * cannot break the sentence. There is no human reviewer in this loop, so the
 * filter is the gate, and it is deliberately narrow:
 *
 *  - the line names both forms: `say X (avoid: Y)`, `say X (not Y)`, or the
 *    bare lexicon shape `- hospital: ஆஸ்பத்திரி (not மருத்துவமனை)`;
 *  - only the FIRST form on each side. Lists mix safe and unsafe members —
 *    Tamil `two: say ரெண்டு (avoid: இரண்டு, இரு)`, where இரு is also the verb
 *    "stay" — so a list's tail is never enforced;
 *  - both forms are exactly ONE word. The runtime matches whole words, so an
 *    inflected form of the avoid-word is never touched;
 *  - the rule is unconditional and about a WORD. Three checks, each from a
 *    live prod rule that would otherwise have been swapped wrongly:
 *      · the avoid group holds nothing but the term and register words —
 *        Hindi `to drink: say पीना (avoid using पाना for this meaning)` would
 *        have rewritten पाना ("to get") everywhere;
 *      · the gloss carries no bracketed context — Tamil `to ignore (pain,
 *        problems): … (avoid: மறுக்கிறேன்)` is also "I refuse";
 *      · the line is not a grammar rule — Marathi `Negations: … (avoid
 *        formal "नाहीत")` is the plural "are not", so the swap breaks
 *        agreement;
 *  - not from a pronoun, kinship or grammar section, and not an address
 *    form. Those change agreement: Hindi आप→तुम needs हैं→हो on the verb, and
 *    Tamil அவர்→அவங்க needs -ார்→-ாங்க;
 *  - no two rules disagree about the same avoid-word.
 *
 * Everything else stays prompt-only. A bad swap is visible afterwards — every
 * swap is logged per turn (`turn_metrics.metadata.glossary_swaps`) — and is
 * fixed by fixing or archiving the rule, which takes effect next session.
 */
import { getLanguageInventories, tokenize } from './variety-feature.util';

export interface GlossarySwap {
  avoid: string;
  say: string;
  sectionCode: string;
}

/** Sanity bound on the list shipped in room metadata. */
export const GLOSSARY_SWAP_CAP = 200;

/** Sections whose rules change agreement, never swapped word-for-word. */
const AGREEMENT_SECTION = /pronoun|kinship|grammar/i;

/** Words allowed beside the avoid-term: they describe register, not scope. */
const REGISTER_WORD =
  /^(formal|literary|archaic|textbook|stilted|pure|bookish|written|the|a|an|or|and|terms?|like|forms?|e\.?g\.?)$/i;

/** A rule about grammar (agreement, morphology), not about a word. */
const GRAMMAR_TEXT =
  /\b(negations?|verbs?|tense|suffix(es)?|endings?|conjugat\w*|plural|singular|case|gerund|forms?|particles?|clitics?|agree\w*)\b/i;

const QUOTED = /`([^`]+)`|"([^"]+)"|“([^”]+)”/;

/** The single word a term consists of, or null. */
function singleWord(term: string | null | undefined): string | null {
  if (!term) return null;
  const trimmed = term.normalize('NFC').trim();
  const tokens = tokenize(trimmed);
  if (tokens.length !== 1) return null;
  // tokenize lowercases Latin; comparing against the trimmed form rejects a
  // term carrying punctuation ("அதனால்.") as not-one-word.
  return tokens[0] === trimmed.toLowerCase() ? trimmed : null;
}

function firstQuoted(text: string): string | null {
  const m = text.match(QUOTED);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

/** Parse one line into its (say, avoid) pair, or null. */
export function parseSwapLine(
  line: string,
): { say: string; avoid: string } | null {
  const text = line.normalize('NFC');
  const group = text.match(/\((?:avoid|not)\b\s*:?\s*([^)]*)\)?/i);
  if (!group) return null;
  const groupBody = group[1] ?? '';
  const quotedAvoid = firstQuoted(groupBody);
  const avoidRaw = quotedAvoid ?? groupBody.trim().split(/[\s,;]/)[0];
  // Anything in the group besides the term(s) and register words scopes the
  // rule ("unless in a clinical context", "for this meaning").
  const rest = (
    quotedAvoid
      ? groupBody.replace(new RegExp(QUOTED.source, 'g'), ' ')
      : groupBody.trim().slice(avoidRaw.length)
  )
    .replace(/[,;:.()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (rest.some((w) => !REGISTER_WORD.test(w))) return null;

  const before = text.slice(0, group.index);
  const context = before.replace(new RegExp(QUOTED.source, 'g'), ' ');
  if (GRAMMAR_TEXT.test(context)) return null;
  const gloss = before.split(/\b(?:say|use)\b|:/i)[0];
  if (/\(/.test(gloss)) return null;
  const sayClause = before.match(/\b(?:say|use)\b\s*:?\s*(.*)$/i);
  let sayRaw: string | null;
  if (sayClause) {
    sayRaw =
      firstQuoted(sayClause[1]) ?? sayClause[1].trim().split(/[\s,;]/)[0];
  } else {
    // Bare lexicon line: `- gloss: WORD (not OTHER)`.
    const bare = before.match(/^\s*[-*]\s*[^:]+:\s*(\S+)\s*$/);
    sayRaw = bare ? (firstQuoted(bare[1]) ?? bare[1]) : null;
  }
  const say = singleWord(sayRaw);
  const avoid = singleWord(avoidRaw);
  if (!say || !avoid || say === avoid) return null;
  return { say, avoid };
}

export function extractGlossarySwaps(
  sections: { sectionCode: string; content?: string | null }[],
  languageValue: string,
): GlossarySwap[] {
  const address = new Set(
    Object.keys(getLanguageInventories(languageValue).addressForms).map((f) =>
      f.normalize('NFC'),
    ),
  );
  const byAvoid = new Map<string, GlossarySwap>();
  const conflicted = new Set<string>();
  for (const section of sections) {
    if (AGREEMENT_SECTION.test(section.sectionCode)) continue;
    for (const line of (section.content ?? '').split('\n')) {
      const pair = parseSwapLine(line);
      if (!pair) continue;
      const { say, avoid } = pair;
      if (address.has(say) || address.has(avoid)) continue;
      const key = avoid.toLowerCase();
      const existing = byAvoid.get(key);
      if (existing && existing.say !== say) {
        conflicted.add(key);
        continue;
      }
      if (!existing) {
        byAvoid.set(key, { avoid, say, sectionCode: section.sectionCode });
      }
    }
  }
  for (const key of conflicted) byAvoid.delete(key);
  return [...byAvoid.values()].slice(0, GLOSSARY_SWAP_CAP);
}
