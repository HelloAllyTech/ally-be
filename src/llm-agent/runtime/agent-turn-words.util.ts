/**
 * Reading what the person said this turn: whether their words owe the agent
 * a record. Shared by Builder's readiness rubric and the validated runner, so
 * "ok, thanks" means the same thing to both.
 */

/**
 * Messages that answer nothing and so owe the agent nothing: "ok", "thanks",
 * "looks good, go ahead". Each comma- or full-stop-separated clause must be
 * one of these for the whole message to count as an acknowledgement.
 */
const ACKNOWLEDGEMENTS = new Set([
  'ok',
  'okay',
  'k',
  'yes',
  'yep',
  'yeah',
  'sure',
  'fine',
  'thanks',
  'thank you',
  'thx',
  'ty',
  'great',
  'good',
  'cool',
  'nice',
  'perfect',
  'done',
  'agreed',
  'looks good',
  'sounds good',
  'lgtm',
  'go ahead',
  'go on',
  'continue',
  'proceed',
  'carry on',
  'next',
]);

export function isAcknowledgement(text: string): boolean {
  const clauses = String(text ?? '')
    .toLowerCase()
    .replace(/[!?'"’]/g, '')
    .split(/[,.;\n]+|\band\b/)
    .map((clause) => clause.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  return (
    clauses.length > 0 &&
    clauses.every((clause) => ACKNOWLEDGEMENTS.has(clause))
  );
}

/** The `[answers question …]` prefix every agent puts on a card answer. */
const ANSWER_PREFIX = /^\[answers question [^\]]*\]\s*/;

/**
 * What the person said this turn in their own words — the text a validated
 * turn must record or explain. Null for an option pick (its custom text is
 * kept), a "none of these", or a plain "ok, thanks".
 */
export function userWordsToApply(
  content: string | null | undefined,
  answer?: { customValues?: unknown[] } | null,
): string | null {
  let text: string;
  if (answer) {
    const custom = Array.isArray(answer.customValues)
      ? answer.customValues.map(String).filter((value) => value.trim())
      : [];
    text = custom.join('\n');
  } else {
    text = String(content ?? '')
      .replace(ANSWER_PREFIX, '')
      .trim();
  }
  return text && !isAcknowledgement(text) ? text : null;
}
