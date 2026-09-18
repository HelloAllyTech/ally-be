/**
 * The register policy the agent is instructed with, derived from the same
 * source the judge grades against.
 *
 * Phase 1 of docs/client-working-memory-design.md §14, and the problem it
 * solves is measurable rather than theoretical. Today the agent's register
 * instruction lives in the LLM-generated `core_style` glossary section, while
 * the judge grades against `languages.evalConfig.targetVariety` (plus the
 * tenant's variety-profile override). Nothing keeps those two in agreement, and
 * Tamil is what that drift looks like in production: 3,225 agent messages with
 * ZERO glossary violations while carrying 1,507 register annotations from the
 * judge. The list said one thing, the grader wanted another, and the agent
 * satisfied the list.
 *
 * So the descriptor is computed ONCE, here, and both callers use it. Drift
 * stops being something to police and becomes something the type system makes
 * awkward to reintroduce.
 */

/**
 * The fallback chain, in one place.
 *
 * Previously this existed twice with two different endings:
 * `resolveVarietyOverride` fell back to `colloquial spoken <label>`, while the
 * judge's call site fell back to `undefined` — rendered by the judge as
 * "unknown". Same question, two answers, depending on which code path asked.
 */
export function resolveTargetVariety(
  evalConfig: Record<string, unknown> | null | undefined,
  languageLabel: string | null | undefined,
): string {
  const configured = (evalConfig as { targetVariety?: unknown } | null)
    ?.targetVariety;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }
  const label = (languageLabel ?? '').trim();
  return label ? `colloquial spoken ${label}` : 'colloquial spoken language';
}

/**
 * The `## Register` block prepended to the Tier 0 style card.
 *
 * Three deliberate properties:
 *
 * 1. **It declares precedence.** `core_style` already carries a generated
 *    register policy, so without an explicit winner this would just add a
 *    second opinion — the exact failure the Kannada glossary has today, where
 *    `core_style` says be colloquial and `pronouns_kinship` says always use the
 *    honorific plural with nothing saying which governs. A derived line that
 *    quietly contradicts an authored one is worse than no derived line.
 * 2. **It is byte-stable for a given (language, tenant).** Tier 0 is compiled
 *    in a fixed order specifically so the system-prompt prefix stays
 *    cache-friendly; a block that reordered or re-worded per turn would defeat
 *    that. Nothing here depends on the turn.
 * 3. **It never edits stored sections.** Authored content stays authored, and
 *    the derived line is derived at read time. The same principle the working
 *    memory applies to `state_x_guidelines`: an instruction a human wrote must
 *    not be paraphrased into an approximation of itself.
 */
export function compileRegisterPolicy(descriptor: string): string {
  const target = (descriptor ?? '').trim();
  if (!target) return '';
  return [
    '## Register',
    `Speak ${target}.`,
    'Where anything below conflicts with this line about which variety or ' +
      'register to speak in, this line wins.',
  ].join('\n');
}
