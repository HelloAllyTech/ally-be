import { AgentToolDefinition } from '../type/agent-llm.type';

/**
 * The tool-belt half of a validated turn: the ending tools carry the reply
 * (`message`), a closing tool exists for a turn with no question, and a
 * protocol block tells the model how a turn ends.
 *
 * The rules are written into tool descriptions and a code-owned system block
 * rather than the agent's prompt, the same choice Builder made: prompts are
 * edited on the dashboard, and a loop change should not need a prompt edit to
 * be understood — nor stop being true when someone edits one.
 */

export interface ValidatedEndingVocabulary {
  /** Who reads the reply ("trainer"). */
  userNoun: string;
  /** What the agent changes, as the model should name it ("the brief or the course"). */
  changeNoun: string;
  /** The asking tool's name (`ask_trainer`). */
  askingTool: string;
  /** The closing tool's name (`finish_turn`). */
  closingTool: string;
  /** The ending tools' "why nothing changed" field, when the agent records the person's words. */
  unchangedField?: string;
}

const messageProperty = (vocabulary: ValidatedEndingVocabulary) => ({
  type: 'string',
  description:
    `What you found and what it changed, in one to three sentences — the only text the ` +
    `${vocabulary.userNoun} sees this turn. Say ${vocabulary.changeNoun} changed only if a ` +
    'change this turn succeeded: it is checked before it is shown.',
});

const unchangedProperty = (vocabulary: ValidatedEndingVocabulary) => ({
  type: 'string',
  description:
    `When the ${vocabulary.userNoun}'s latest message, in their own words, changes nothing ` +
    `in ${vocabulary.changeNoun}: why (e.g. "they asked how publishing works"). Leave it ` +
    'out whenever you made a change.',
});

const endingProperties = (vocabulary: ValidatedEndingVocabulary) => ({
  message: messageProperty(vocabulary),
  ...(vocabulary.unchangedField
    ? { [vocabulary.unchangedField]: unchangedProperty(vocabulary) }
    : {}),
});

const ON_ITS_OWN =
  'Call it on its own, after you have read every result: a call made in the same step ' +
  'as a lookup, or after a lookup or edit failed, is sent back to you undelivered.';

/** The asking tool, extended to carry the reply. */
export function withValidatedAsk(
  tool: AgentToolDefinition,
  vocabulary: ValidatedEndingVocabulary,
): AgentToolDefinition {
  const schema = tool.input_schema ?? {};
  return {
    ...tool,
    description:
      `${tool.description}\nThis ends your turn, and \`message\` is the text the ` +
      `${vocabulary.userNoun} reads above the card. ${ON_ITS_OWN}`,
    input_schema: {
      ...schema,
      properties: {
        ...(schema.properties ?? {}),
        ...endingProperties(vocabulary),
      },
      required: [...new Set([...(schema.required ?? []), 'message'])],
    },
  };
}

/** The closing tool: ends a turn with no question. */
export function closingToolDefinition(
  vocabulary: ValidatedEndingVocabulary,
  when: string,
): AgentToolDefinition {
  return {
    name: vocabulary.closingTool,
    description:
      `End your turn without a question: ${when}. \`message\` is the only text the ` +
      `${vocabulary.userNoun} sees. ${ON_ITS_OWN}`,
    input_schema: {
      type: 'object',
      properties: endingProperties(vocabulary),
      required: ['message'],
    },
  };
}

/**
 * How a validated turn ends, for the model. A system block of its own (or a
 * section appended to a string prompt), after the instructions, so it reaches
 * the model whatever the dashboard's version of the prompt says — and only
 * while the setting is on.
 */
export function renderTurnProtocol(
  vocabulary: ValidatedEndingVocabulary,
  agentRules: string[] = [],
): string {
  const { userNoun, askingTool, closingTool, unchangedField, changeNoun } =
    vocabulary;
  return [
    '# How a turn ends',
    '',
    `Every turn ends with exactly one call to \`${askingTool}\` (a question) or ` +
      `\`${closingTool}\` (no question). Its \`message\` is the only text the ${userNoun} ` +
      'sees: anything you write outside it is kept as your working notes and never shown. So:',
    '',
    '- Look things up first and read the results, then end the turn in a later step. A ' +
      'turn-ending call made in the same step as a lookup is sent back to you, because its ' +
      'message was written before the results existed.',
    '- If a lookup or a change fails, deal with it before you end the turn: retry it, try ' +
      'another way, or say plainly in the message that it failed.',
    `- Say ${changeNoun} changed only when a change this turn succeeded. It is checked, and ` +
      'a message that says otherwise comes back to you.',
    ...(unchangedField
      ? [
          `- When the ${userNoun}'s message gives you something to record, record it before ` +
            `you end the turn. If it changes nothing, say why in \`${unchangedField}\`.`,
        ]
      : []),
    `- When a tool says it ends the turn (it asked the ${userNoun} to confirm, or put ` +
      `something in front of them to review), call \`${closingTool}\` next: its message sits ` +
      'above what the tool showed them.',
    ...agentRules.map((rule) => `- ${rule}`),
    `- The ${userNoun} sees a receipt under your message — what you read, what changed and ` +
      'what failed — built from the tools, so do not narrate your lookups.',
  ].join('\n');
}
