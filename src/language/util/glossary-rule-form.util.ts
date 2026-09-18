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
 * A rule is CANONICAL when its OPENING LINE names both the form to use and the
 * form to avoid — either in `(avoid: Y)` syntax, or in prose that points at
 * concrete terms ("use `X` … not the formal `Y`"). Both bind; only the
 * abstract opener with its pairs buried in an example does not.
 *
 * Getting this boundary wrong is expensive in the direction of over-rejection:
 * a first cut treated every rule carrying an example as buried, and a dry run
 * auto-rejected six perfectly good rules before any model saw them. Hence the
 * narrower test below.
 */

/** The `(avoid: X)` / `(not X)` group the generation prompts emit. */
const AVOID_GROUP = /\((?:avoid|not)\s*:?\s*[^)]+\)/i;

/** A term the rule points at concretely: backticked, quoted or typographic. */
const QUOTED_TERM = /`[^`]+`|"[^"]+"|'[^']+'|[“‘][^”’]+[”’]/;

/** Words by which a line names the form to move AWAY from. */
const CONTRAST = /\b(not|avoid|rather than|instead of|never)\b/i;

/**
 * Does this line state the substitution itself?
 *
 * Either syntax counts. `- yes: say \`ஆமா\` (avoid: \`ஆமாம்\`)` is the shape the
 * prompts emit, but prose does the same work: "Use the informal pronoun
 * \`तुम\` … not the formal \`आप\`" names both forms just as concretely, and
 * rejecting it as non-binding was wrong — the dry run on 2026-09-02 rejected
 * six such rules before a model ever saw them.
 *
 * What the Kannada evidence actually condemned is a line with NO concrete
 * term on it at all ("written Kannada keeps vowels that speech drops (schwa
 * deletion). This is a pattern, apply it everywhere:") whose pairs live only
 * in a following example. That is the 4% case, and it is what this must catch
 * — not any rule that happens to carry an example.
 */
function statesSubstitution(line: string): boolean {
  if (AVOID_GROUP.test(line)) return true;
  return QUOTED_TERM.test(line) && CONTRAST.test(line);
}

/**
 * A rule whose actionable pair sits ONLY on a continuation line, under an
 * opening line that names no concrete form — the shape that measured 4%
 * compliance.
 */
function pairIsOnlyInExample(markdown: string): boolean {
  const lines = markdown.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  if (statesSubstitution(lines[0])) return false;
  // An opening line that at least points at a concrete term is prose guidance,
  // not the buried-pattern shape; leave that judgement to the adjudicator.
  if (QUOTED_TERM.test(lines[0])) return false;
  return lines.slice(1).some((l) => statesSubstitution(l));
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
  if (statesSubstitution(firstLine)) return 'canonical';
  return statesSubstitution(text) ? 'canonical' : 'no_substitution';
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
