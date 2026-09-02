/**
 * Does a proposed rule take a form the agent actually obeys?
 *
 * This is not style policing — it is the strongest empirical finding we have
 * about the glossary. Measured on the live Kannada glossary 2026-09-02, with
 * every rule sitting in the same published `always` section and therefore in
 * the same prompt:
 *
 *   canonical one-liner  `- worry: say X (avoid: Y)`   100% compliance
 *                                                     (prescribed 35 / proscribed 0)
 *   demoted to a shared `e.g.` line under an abstract
 *   pattern statement ("schwa deletion, apply it
 *   everywhere")                                      3.9% and 0% compliance
 *                                                     (ಆದ್ರೆ 10 / ಆದರೆ 245;
 *                                                      ಯಾಕಂದ್ರೆ 0 / ಏಕೆಂದರೆ 14)
 *
 * So an abstract rule is not a cheap rule — it is an ineffective one that
 * still spends the Tier 0 token budget. Publishing it looks like progress and
 * changes nothing, which is worse than rejecting it.
 *
 * A rule is CANONICAL when it names the form to use and the form to avoid in
 * one line: `say X (avoid: Y)`, or `X (not Y)`. Those are the two shapes the
 * generation and consolidation prompts emit and the shapes
 * `parseAvoidTerms` can machine-check.
 */

/** A rule that states its substitution inline, on the line itself. */
const CANONICAL = /(\bsay\b[^\n]*|[^\n]*)\((?:avoid|not)\s*:?\s*[^)]+\)/i;

/**
 * A rule whose actionable pair sits on a CONTINUATION line under a general
 * statement — the shape that measured 4% compliance. Detected as: the first
 * line carries no substitution, and a later `e.g.`-style line does.
 */
function pairIsOnlyInExample(markdown: string): boolean {
  const lines = markdown.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const firstHasPair = CANONICAL.test(lines[0]);
  const laterHasPair = lines.slice(1).some((l) => CANONICAL.test(l));
  return !firstHasPair && laterHasPair;
}

export type RuleForm = 'canonical' | 'pair_only_in_example' | 'no_substitution';

/**
 * Classify a proposed rule's form. `no_substitution` covers rules that never
 * name a form to avoid — pure prose guidance, which the deterministic
 * adherence scan also cannot check.
 */
export function classifyRuleForm(markdown: string): RuleForm {
  const text = (markdown ?? '').trim();
  if (!text) return 'no_substitution';
  if (pairIsOnlyInExample(text)) return 'pair_only_in_example';
  const firstLine = text.split('\n')[0];
  if (CANONICAL.test(firstLine)) return 'canonical';
  return CANONICAL.test(text) ? 'canonical' : 'no_substitution';
}

/**
 * True when the form is one the agent has been observed to follow. Prose
 * guidance is NOT auto-rejected here — some legitimate rules are genuinely
 * behavioural — but it is flagged so the adjudicator weighs it knowing the
 * compliance evidence.
 */
export function isBindingForm(markdown: string): boolean {
  return classifyRuleForm(markdown) === 'canonical';
}
