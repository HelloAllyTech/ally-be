import { PRD_SECTION_KEYS } from '../util/builder-prd-edits.util';
import { BUILDER_REPO_NAMES } from './builder-repos.constants';

/**
 * The tool definitions validated turns add to the interview's belt
 * (builder_settings.validatedTurns). The legacy belt lives in
 * BuilderInterviewToolsService; these extend it.
 *
 * The rules a validated turn is held to are written into the tool descriptions
 * and the turn-protocol block rather than the interviewer prompt: the prompt is
 * edited on the dashboard and gated by the replay eval, and a loop change
 * should not need a prompt edit to be understood.
 */

/** What a turn-ending call is told it must carry. Shared by ask_admin and finish_turn. */
const MESSAGE_PROPERTY = {
  type: 'string',
  description:
    'What you found and what it changed, in one to three sentences — the only text the ' +
    'admin sees this turn. Say the PRD changed only if an edit this turn succeeded, and that ' +
    'it is ready only if readiness says so: both are checked before it is shown.',
};

const PRD_UNCHANGED_PROPERTY = {
  type: 'string',
  description:
    "When the admin's latest message, in their own words, changes nothing in the PRD: why " +
    '(e.g. "they asked how readiness works"). Leave it out whenever you edited the PRD.',
};

/** Appended to ask_admin's description in validated mode. */
export const ASK_ADMIN_VALIDATED_NOTE =
  'This ends your turn, and `message` is the text the admin reads above the card. Call it ' +
  'on its own, after you have read every result: a call made in the same step as a lookup, ' +
  'or after a lookup or edit failed, is sent back to you undelivered.';

/** Added to ask_admin's schema in validated mode. */
export const ASK_ADMIN_VALIDATED_PROPERTIES = {
  message: MESSAGE_PROPERTY,
  prdUnchangedBecause: PRD_UNCHANGED_PROPERTY,
};

export const FINISH_TURN_TOOL = {
  name: 'finish_turn',
  description:
    'End your turn without a question: when the PRD is build-ready, or when you are ' +
    'answering something the admin asked. `message` is the only text the admin sees. Call it ' +
    'on its own, after you have read every result: a call made in the same step as a lookup, ' +
    'or after a lookup or edit failed, is sent back to you undelivered.',
  input_schema: {
    type: 'object',
    properties: {
      message: MESSAGE_PROPERTY,
      prdUnchangedBecause: PRD_UNCHANGED_PROPERTY,
    },
    required: ['message'],
  },
};

/** Appended to update_prd's description in validated mode. */
export const UPDATE_PRD_BY_ID_NOTE =
  'Prefer the edit-by-id tools (set_section, upsert_requirement, set_repo_plan…): they name ' +
  'the entry, so nothing can shift under them. Here too, an id or repo name works where an ' +
  'index would — "/requirements/R3/title", "/technicalPlan/repos/ally-be/changesMd" — and ' +
  '"add" to "/goals/-" (any prose field) appends a line.';

const CHANGE_SUMMARY = {
  type: 'string',
  description: 'One line on what moved, for the version history',
};

export const PRD_EDIT_TOOLS = [
  {
    name: 'set_section',
    description:
      'Write one prose section of the PRD by its key: replace it (the default) or add your ' +
      'text as a new line after it ("append"). Requirements, assumptions, repo plans and ' +
      'open questions have their own tools.',
    input_schema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: [...PRD_SECTION_KEYS] },
        text: { type: 'string', description: 'Markdown' },
        mode: { type: 'string', enum: ['replace', 'append'] },
        changeSummary: CHANGE_SUMMARY,
      },
      required: ['section', 'text'],
    },
  },
  {
    name: 'upsert_requirement',
    description:
      'Create or change one requirement by its id ("R1", "R2"…). Fields you pass replace ' +
      'those fields; fields you leave out are kept. An id that does not exist yet adds the ' +
      'requirement. Then name the id in the plan of each repo that builds it.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Observable, testable sentences — the build turns each into a test',
        },
        changeSummary: CHANGE_SUMMARY,
      },
      required: ['id'],
    },
  },
  {
    name: 'remove_requirement',
    description:
      'Remove one requirement by id. A repo plan that names it still does — rewrite that ' +
      'plan with set_repo_plan.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' }, changeSummary: CHANGE_SUMMARY },
      required: ['id'],
    },
  },
  {
    name: 'set_repo_plan',
    description:
      'Write what changes in one repo, by repo name: adds the repo to the technical plan or ' +
      'replaces its changes. Name each requirement id the repo builds, e.g. "(R2) store the ' +
      'rating on the debrief". A plan entry always names a repo — if you do not know which ' +
      'repo owns a change yet, that is an open question.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', enum: BUILDER_REPO_NAMES },
        changesMd: { type: 'string', description: 'Markdown' },
        changeSummary: CHANGE_SUMMARY,
      },
      required: ['repo', 'changesMd'],
    },
  },
  {
    name: 'remove_repo_plan',
    description: 'Take one repo out of the technical plan, by repo name.',
    input_schema: {
      type: 'object',
      properties: {
        repo: { type: 'string', enum: BUILDER_REPO_NAMES },
        changeSummary: CHANGE_SUMMARY,
      },
      required: ['repo'],
    },
  },
  {
    name: 'upsert_assumption',
    description:
      'Record an inference by id ("A1"…) as unconfirmed, then set it confirmed once the ' +
      'admin or a lookup settles it. Fields you leave out are kept. Attach `evidence` only ' +
      'when a lookup settled it, with the finding rather than the fact that you looked.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        text: { type: 'string' },
        status: { type: 'string', enum: ['unconfirmed', 'confirmed'] },
        evidence: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'The lookup tool' },
            detail: {
              type: 'string',
              description: 'What it found, in one line',
            },
          },
        },
        changeSummary: CHANGE_SUMMARY,
      },
      required: ['id'],
    },
  },
  {
    name: 'set_open_questions',
    description:
      'Replace the whole open-questions list — plain sentences. Pass [] once everything is ' +
      'settled. Each open question blocks the build, so ask rather than park what you can ask.',
    input_schema: {
      type: 'object',
      properties: {
        questions: { type: 'array', items: { type: 'string' } },
        changeSummary: CHANGE_SUMMARY,
      },
      required: ['questions'],
    },
  },
];

/**
 * How a validated turn ends, for the model. A system block of its own, after
 * the instructions, so it reaches the model whatever the dashboard's version
 * of the interviewer prompt says — and only when the setting is on.
 */
export const BUILDER_TURN_PROTOCOL = [
  '# How a turn ends',
  '',
  'Every turn ends with exactly one call to `ask_admin` (a question) or `finish_turn` (no ' +
    'question). Its `message` is the only text the admin sees: anything you write outside ' +
    'it is kept as your working notes and never shown. So:',
  '',
  '- Look things up first and read the results, then end the turn in a later step. A ' +
    'turn-ending call made in the same step as a lookup is sent back to you, because its ' +
    'message was written before the results existed.',
  '- If a lookup or an edit fails, deal with it before you end the turn: retry it, try ' +
    'another path, or say plainly in the message that it failed.',
  '- Say the PRD changed only when an edit this turn succeeded, and that it is ready only ' +
    'when the readiness block says ready. Both are checked, and a message that says ' +
    'otherwise comes back to you.',
  "- When the admin's message gives you something to record, record it before you end the " +
    'turn. If it changes nothing in the PRD, say why in `prdUnchangedBecause`.',
  '- Edit the PRD by what an entry is, not where it sits: `set_section` for prose, ' +
    '`upsert_requirement` / `remove_requirement` by requirement id, `set_repo_plan` / ' +
    '`remove_repo_plan` by repo name, `upsert_assumption` by assumption id, ' +
    '`set_open_questions` for the list. `update_prd` still works for anything else.',
  '- The admin sees a receipt under your message — what you read, what changed in the PRD ' +
    'and what failed — built from the tools, so do not narrate your lookups.',
].join('\n');

/**
 * The interview protocol (builder_settings.situationBrief), for the model:
 * appended after the turn protocol while it is on.
 */
export const BUILDER_INTERVIEW_PROTOCOL = [
  '# How this interview runs',
  '',
  '- **The opening turn is a situation brief.** Before you reply, the server searches the ' +
    'platform map, docs, wiki and code and gives you what it found as `<discovery>`. Read the ' +
    'files that matter, then end the turn with `submit_situation_brief`: what already exists ' +
    '(each line citing the discovery ref or file that found it), what of the request is ' +
    'already met, a reuse / extend / new proposal per part, and every repo it lands in. No ' +
    'question until the admin has answered the brief.',
  '- **Their answer settles the brief.** Write what they confirmed into the PRD and apply ' +
    'every correction before anything else; never re-ask a confirmed line.',
  '- **Only decisions are asked.** Every `ask_admin` names its type — scope, behaviour, ' +
    'priority, taste or contradiction — what it rests on, and why research cannot settle it. ' +
    'How the code works, or what exists today, you look up; a question about it comes back ' +
    'to you. If a recommendation departs from the brief, say so in `basis`.',
  '- **Write when settled.** When the hand-off and what the admin said settle a part of the ' +
    'PRD, write it instead of asking about it.',
].join('\n');
