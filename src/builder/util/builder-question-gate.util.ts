/**
 * The question gate (W4): only decisions are asked.
 *
 * In the last eleven production interviews Builder asked 3.9 questions per
 * PRD, some of them about how the code works — a question the admin cannot
 * answer better than a lookup can, which also tells them Builder had not
 * looked. With the gate, every `ask_admin` names its type (a decision only the
 * admin can make), what it rests on, and why research cannot settle it. The
 * type is the model's own label, so a fact question dressed up as a scope
 * question still gets through here; the cold PRD reviewer and the replay eval
 * are what catch that.
 *
 * "Explain why clarification is needed" and "reference what was already said"
 * are Stacks, "Sequencing clarification questions to avoid user overwhelm".
 */

export const BUILDER_QUESTION_TYPES = [
  'scope',
  'behaviour',
  'priority',
  'taste',
  'contradiction',
] as const;
export type BuilderQuestionType = (typeof BUILDER_QUESTION_TYPES)[number];

/** Added to ask_admin's schema while the protocol is on. */
export const QUESTION_GATE_PROPERTIES = {
  questionType: {
    type: 'string',
    enum: [...BUILDER_QUESTION_TYPES],
    description:
      'The decision this asks for: scope (what is in or out), behaviour (what should happen), ' +
      'priority (what matters more), taste (a judgement call), contradiction (two things they ' +
      'said, or what they said and the code, disagree). Not a question about how the code ' +
      'works — look that up.',
  },
  basis: {
    type: 'string',
    description:
      'What the question and your recommendation rest on — a brief line (X1, P2…), a ' +
      'discovery ref (E3), a file you read, or what the admin said. Say so if your ' +
      'recommendation departs from the brief.',
  },
  whyNotResearch: {
    type: 'string',
    description:
      'Why no lookup can settle this — e.g. "the code supports both; which one they want is ' +
      'their call".',
  },
};

export const QUESTION_GATE_REQUIRED = [
  'questionType',
  'basis',
  'whyNotResearch',
];

/** Appended to ask_admin's description while the protocol is on. */
export const ASK_ADMIN_GATE_NOTE =
  'Ask only for a decision the admin has to make — never how the code works or what exists ' +
  'today, which you look up. Name the question type, what it rests on (`basis`) and why ' +
  'research cannot settle it (`whyNotResearch`); the admin sees the last two on the card.';

/**
 * A question about how the platform works rather than a decision. Narrow on
 * purpose: it holds a question back once, so it should fire on phrasings that
 * are almost never a decision.
 */
const CODE_QUESTION =
  /\b(where (is|are|does|do)\b.*\b(stored|defined|live|lives|implemented|handled|computed|kept)|which (file|table|column|service|module|endpoint|repo|component|class|function)\b.*\b(handles|stores|owns|does|holds|renders|contains)|how does (the|our|this|ally)\b.*\b(currently )?(work|works|handle|handles|store|stores|compute|computes)|does (the|our) (code|codebase|backend|system|platform|database|schema) (already )?(have|support|store|track|record)|is there (an? )?(existing )?(table|endpoint|column|service|module|api|field) (for|that))\b/i;

export function looksLikeACodeQuestion(
  prompt: string | null | undefined,
): boolean {
  return CODE_QUESTION.test(String(prompt ?? ''));
}

export interface QuestionGateProblem {
  key: string;
  toModel: string;
  toAdmin: string;
}

/** What is wrong with an ask_admin under the gate; empty when it passes. */
export function questionGateProblems(
  input: Record<string, any>,
): QuestionGateProblem[] {
  const problems: QuestionGateProblem[] = [];
  const type = String(input?.questionType ?? '').trim();
  if (!BUILDER_QUESTION_TYPES.includes(type as BuilderQuestionType)) {
    problems.push({
      key: 'question_type',
      toModel:
        'Every question names its type — scope, behaviour, priority, taste or contradiction. ' +
        'If it fits none of them it is not a decision for the admin: look it up, or record ' +
        'it as an assumption, instead of asking.',
      toAdmin:
        'Builder asked a question without saying what kind of decision it is.',
    });
  }
  if (!String(input?.basis ?? '').trim()) {
    problems.push({
      key: 'question_basis',
      toModel:
        'Say what the question rests on in `basis`: a brief line, a discovery ref, a file you ' +
        'read, or what the admin said.',
      toAdmin: 'Builder asked a question without saying what it rests on.',
    });
  }
  if (!String(input?.whyNotResearch ?? '').trim()) {
    problems.push({
      key: 'question_why',
      toModel:
        'Say in `whyNotResearch` why no lookup can settle this. If one could, run it instead ' +
        'of asking.',
      toAdmin:
        "Builder didn't say why it couldn't look this up instead of asking.",
    });
  }
  if (looksLikeACodeQuestion(input?.prompt)) {
    problems.push({
      key: 'code_question',
      toModel:
        'That asks how the platform works, which the admin is no better placed to answer ' +
        'than a lookup: search the platform map, docs or code (capability_lookup, ' +
        'docs_search, github_search_code) and decide from what you find. Ask only the ' +
        'decision that is left.',
      toAdmin: 'Builder asked how the platform works instead of looking it up.',
    });
  }
  return problems;
}

/**
 * The card's rationale under the gate: the model's own, then what the
 * question rests on and why it is the admin's to decide.
 */
export function gatedRationale(input: Record<string, any>): string {
  return [
    String(input?.rationale ?? '').trim(),
    String(input?.basis ?? '').trim()
      ? `Based on: ${String(input.basis).trim()}`
      : '',
    String(input?.whyNotResearch ?? '').trim()
      ? `Yours to decide because: ${String(input.whyNotResearch).trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
