import { ValidatedEndingVocabulary } from 'src/llm-agent/runtime/agent-turn-tools.util';
import {
  AgentReceiptCall,
  AgentReceiptVocabulary,
  clipText,
  plural,
} from 'src/llm-agent/runtime/agent-turn-receipt.util';

/**
 * What the character interview's validated turns need to know about its
 * tools: two lookups, one write, and the claim a reply can be checked on —
 * that the draft is saved.
 *
 * No "why your words changed nothing" field: the interview keeps the admin's
 * answers in the transcript until the draft is written, so there is nothing a
 * turn owes them a record in.
 */

export const CHARACTER_INTERVIEW_TURN_VOCABULARY: ValidatedEndingVocabulary = {
  userNoun: 'admin',
  changeNoun: 'the character draft',
  askingTool: 'ask_question',
  closingTool: 'finish_turn',
};

/** When the closing tool is the right ending, for its description. */
export const CHARACTER_INTERVIEW_FINISH_WHEN =
  'after save_character_draft succeeds (thank the admin briefly and point them to the ' +
  'review form), or when you are answering something they asked';

/** The interview's own lines in the turn protocol. */
export const CHARACTER_INTERVIEW_TURN_RULES = [
  'Never say the character is saved, ready or waiting for review unless ' +
    'save_character_draft succeeded this turn. If it failed, fix the fields it lists and ' +
    'call it again, or say plainly that it did not go through.',
];

export const CHARACTER_INTERVIEW_LOOKUP_TOOLS = new Set([
  'get_voices',
  'search_corpus',
]);

export const CHARACTER_INTERVIEW_ENDING_TOOLS = new Set([
  'ask_question',
  'finish_turn',
]);

export const isCharacterInterviewLookup = (name: string): boolean =>
  CHARACTER_INTERVIEW_LOOKUP_TOOLS.has(name);

export const isCharacterInterviewEdit = (name: string): boolean =>
  name === 'save_character_draft';

/** What a call set out to do, in the admin's terms. */
export function describeCharacterInterviewAttempt(
  name: string,
  input: Record<string, any> = {},
): string {
  switch (name) {
    case 'get_voices':
      return 'Voices';
    case 'search_corpus':
      return `Corpus search "${clipText(input?.query, 80)}"`;
    case 'save_character_draft':
      return `Save the character draft${input?.name ? ` (${clipText(input.name, 60)})` : ''}`;
    default:
      return name;
  }
}

const lengthOf = (value: unknown): number =>
  Array.isArray(value) ? value.length : 0;

export const CHARACTER_INTERVIEW_RECEIPT_VOCABULARY: AgentReceiptVocabulary = {
  isEnding: (name) => CHARACTER_INTERVIEW_ENDING_TOOLS.has(name),
  isResearch: isCharacterInterviewLookup,
  describeAttempt: describeCharacterInterviewAttempt,
  describeFound: (call: AgentReceiptCall) =>
    call.name === 'search_corpus'
      ? plural(lengthOf(call.result?.passages), 'passage')
      : call.name === 'get_voices'
        ? plural(lengthOf(call.result?.voices), 'voice')
        : 'done',
  // The corpus failure's text is an instruction to the model ("do not tell
  // the admin it has nothing"); the admin gets what happened.
  describeFailure: (call: AgentReceiptCall) =>
    call.name === 'search_corpus' && !call.result?.message
      ? 'the reference corpus could not be reached'
      : null,
};

/** The receipt's "changed": the one thing a turn of this interview writes. */
export function describeCharacterInterviewChanges(
  draft: Record<string, any> | null,
): string[] {
  return draft
    ? [
        `Character draft saved${draft.name ? `: ${clipText(draft.name, 60)}` : ''}`,
      ]
    : [];
}

/**
 * Prose that tells the admin the draft exists. Narrow on purpose, as
 * Builder's is: "I'll write her profile" is a promise, not a claim.
 */
const CLAIMS_A_DRAFT =
  /\b(draft|profile|character)\s+(is|has been|was)\s+(now\s+)?(ready|saved|created|complete|done|submitted)\b|\bready for (your )?review\b|\b(I'?ve|I have)\s+(just\s+)?(saved|created|drafted|written|built|submitted|finished)\b/gi;

const NOT_A_CLAIM =
  /(?:\b(?:not|never|almost|nearly|once|until|when|before|after|if|close to)|n['’]t)\s+(?:yet\s+)?(?:\w+\s+){0,2}$/i;

export function claimsCharacterDraft(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  for (const match of value.matchAll(CLAIMS_A_DRAFT)) {
    const before = value.slice(
      Math.max(0, (match.index ?? 0) - 30),
      match.index,
    );
    if (!NOT_A_CLAIM.test(before)) return true;
  }
  return false;
}
