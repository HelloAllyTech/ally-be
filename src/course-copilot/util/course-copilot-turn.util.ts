import { ValidatedEndingVocabulary } from 'src/llm-agent/runtime/agent-turn-tools.util';
import {
  AgentReceiptCall,
  AgentReceiptVocabulary,
  clipText,
  plural,
} from 'src/llm-agent/runtime/agent-turn-receipt.util';

/**
 * What Course Copilot's validated turns need to know about its own tools and
 * state: which calls only read, how a call reads on the receipt, what "the
 * turn changed something" means, and the claims a reply can be checked on.
 */

export const COURSE_COPILOT_TURN_VOCABULARY: ValidatedEndingVocabulary = {
  userNoun: 'trainer',
  changeNoun: 'the brief, the blueprint or the course',
  askingTool: 'ask_trainer',
  closingTool: 'finish_turn',
  unchangedField: 'unchangedBecause',
};

/** When the closing tool is the right ending, for its description. */
export const COURSE_COPILOT_FINISH_WHEN =
  'after a change the trainer asked for, after a tool put something in front of them ' +
  '(a blueprint to review, a confirmation), or when you are answering their question';

/** Course Copilot's own lines in the turn protocol. */
export const COURSE_COPILOT_TURN_RULES = [
  'After `propose_blueprint` succeeds, say in one or two sentences what shape you chose and ' +
    'why, and any problem the trainer must fix — not the item list; they can see it.',
  'Nothing the trainer tells you may be lost: if it fits no brief field, add it to /notes ' +
    'before you end the turn.',
];

/** Calls that only read. Everything else that is not a turn-ending call changes something. */
export const COURSE_COPILOT_LOOKUP_TOOLS = new Set([
  'list_competencies',
  'get_competency_behaviours',
  'get_languages',
  'get_trigger_warnings',
  'list_cover_images',
  'search_library',
  'design_guidance_search',
  'design_guidance_get',
  'get_course_outline',
  'get_item',
  'list_organisations',
]);

export const COURSE_COPILOT_ENDING_TOOLS = new Set([
  'ask_trainer',
  'finish_turn',
]);

export const isCourseCopilotLookup = (name: string): boolean =>
  COURSE_COPILOT_LOOKUP_TOOLS.has(name);

export const isCourseCopilotEdit = (name: string): boolean =>
  !COURSE_COPILOT_LOOKUP_TOOLS.has(name) &&
  !COURSE_COPILOT_ENDING_TOOLS.has(name);

const quoted = (value: unknown): string => `"${clipText(value, 80)}"`;

const humanise = (name: string): string => {
  const words = name.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** What a call set out to do, in the trainer's terms. */
export function describeCourseCopilotAttempt(
  name: string,
  input: Record<string, any> = {},
): string {
  switch (name) {
    case 'search_library':
      return `Library search ${quoted(input?.query)}${input?.kind ? ` (${input.kind})` : ''}`;
    case 'design_guidance_search':
      return `Design guidance search ${quoted(input?.query)}`;
    case 'design_guidance_get':
      return 'Read design guidance';
    case 'list_competencies':
      return `Competencies${input?.query ? ` ${quoted(input.query)}` : ''}`;
    case 'get_competency_behaviours':
      return 'Competency behaviours';
    case 'get_languages':
      return 'Languages';
    case 'get_trigger_warnings':
      return 'Trigger warnings';
    case 'list_cover_images':
      return 'Cover library';
    case 'get_course_outline':
      return 'Course outline';
    case 'get_item':
      return `Item ${input?.itemId ?? input?.id ?? '?'}`;
    case 'list_organisations':
      return 'Organisations';
    case 'update_brief':
      return 'Brief edit';
    case 'update_blueprint':
      return 'Blueprint edit';
    case 'propose_blueprint':
      return 'Blueprint proposal';
    case 'publish_course':
      return 'Publish the course';
    case 'duplicate_course':
      return 'Duplicate the course';
    default:
      return humanise(name);
  }
}

/** Headings in a Stacks get_chunks answer: the guidance that was read. */
const chunkTitles = (text: unknown): string[] =>
  [...String(text ?? '').matchAll(/^##\s+(.+)$/gm)].map((match) =>
    clipText(match[1], 80),
  );

const lengthOf = (value: unknown): number =>
  Array.isArray(value) ? value.length : 0;

export const COURSE_COPILOT_RECEIPT_VOCABULARY: AgentReceiptVocabulary = {
  isEnding: (name) => COURSE_COPILOT_ENDING_TOOLS.has(name),
  isResearch: isCourseCopilotLookup,
  describeAttempt: describeCourseCopilotAttempt,
  describeRead: (call: AgentReceiptCall) => {
    if (call.name === 'design_guidance_get') {
      const titles = chunkTitles(call.result?.chunks);
      return titles.length
        ? titles.map((title) => `Guidance: ${title}`)
        : ['Design guidance'];
    }
    if (call.name === 'get_item') {
      const title = call.result?.item?.title ?? call.result?.title;
      return [
        title
          ? `Item ${quoted(title)}`
          : describeCourseCopilotAttempt(call.name, call.input),
      ];
    }
    if (call.name === 'get_course_outline') return ['Course outline'];
    return null;
  },
  describeFound: (call: AgentReceiptCall) => {
    const result = call.result ?? {};
    switch (call.name) {
      case 'search_library':
        return plural(lengthOf(result.hits), 'match', 'matches');
      case 'design_guidance_search': {
        const hits =
          String(result.results ?? '').match(/^\[\d+\]/gm)?.length ?? 0;
        return plural(hits, 'hit');
      }
      case 'list_competencies':
        return plural(
          lengthOf(result.competencies),
          'competency',
          'competencies',
        );
      case 'get_languages':
        return plural(lengthOf(result.languages), 'language');
      case 'list_cover_images':
        return plural(lengthOf(result.images), 'image');
      case 'list_organisations':
        return plural(
          lengthOf(result.organisations ?? result.tenants),
          'organisation',
        );
      default:
        return 'done';
    }
  },
};

/** Brief fields as the trainer would name them. */
const BRIEF_LABELS: Record<string, string> = {
  seed: 'purpose',
  audience: 'audience',
  outcomes: 'outcomes',
  competencyIds: 'competencies',
  competencyNames: 'competencies',
  behaviours: 'behaviours',
  assessment: 'assessment',
  shape: 'shape',
  practice: 'practice',
  look: 'look',
  videoUrls: 'videos',
  notes: 'notes',
};

/** The course state a turn can change, as the turn found it and left it. */
export interface CourseCopilotTurnSnapshot {
  brief: Record<string, any> | null | undefined;
  blueprintVersion: number | null | undefined;
  status: string;
}

/**
 * What moved this turn: brief fields by name, the blueprint by version, and
 * the course by the change log's own lines (each edit tool writes one, and
 * pushes it to the pane as `course_patch`). `queued` are background jobs a
 * tool started — a cover image, a roleplay.
 */
export function describeCourseCopilotChanges(input: {
  before: CourseCopilotTurnSnapshot;
  after: CourseCopilotTurnSnapshot;
  coursePatches: string[];
  queued: string[];
}): string[] {
  const { before, after } = input;
  const lines: string[] = [];

  const from = before.brief ?? {};
  const to = after.brief ?? {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  const changedFields = [
    ...new Set(
      [...keys]
        .filter((key) => JSON.stringify(from[key]) !== JSON.stringify(to[key]))
        .map((key) => BRIEF_LABELS[key] ?? key),
    ),
  ];
  if (changedFields.length) lines.push(`Brief: ${changedFields.join(', ')}`);

  const wasVersion = before.blueprintVersion ?? null;
  const nowVersion = after.blueprintVersion ?? null;
  if (nowVersion !== wasVersion && nowVersion !== null) {
    lines.push(
      wasVersion === null || wasVersion === 0
        ? `Blueprint drafted (v${nowVersion})`
        : `Blueprint v${wasVersion} → v${nowVersion}`,
    );
  }

  lines.push(...input.coursePatches.map((summary) => `Course: ${summary}`));
  lines.push(...input.queued);
  return [...new Set(lines.filter(Boolean))];
}

/**
 * Prose that tells the trainer something changed. Deliberately narrow, as
 * Builder's is: "I'll add" is a promise, and a check that fired on ordinary
 * sentences would teach the model to write around it.
 */
const CLAIMS_A_COURSE_CHANGE =
  /\b(I'?ve|I have|I)\s+(just\s+)?(updated|revised|added|amended|rewritten|rewrote|recorded|captured|noted|changed|removed|deleted|renamed|moved|reordered|replaced|regenerated|published|created|drafted|swapped|saved|tightened|shortened)\b|\b(brief|blueprint|course|section|item|quiz|article|journal|cover)\s+(is|has been|was|now)\s+(updated|revised|changed|published|renamed|removed|added|saved)\b/i;

export function claimsCourseChange(text: string | null | undefined): boolean {
  return CLAIMS_A_COURSE_CHANGE.test(String(text ?? ''));
}

/** Prose that tells the trainer the brief is ready for planning. */
const CLAIMS_BRIEF_READY =
  /\b(brief is (now )?(ready|complete)|ready (for|to (draft|plan|propose)) (the|a) blueprint)\b/i;

const NOT_A_CLAIM =
  /(?:\b(?:not|never|almost|nearly|once|until|when|before|after|if|close to)|n['’]t)\s+(?:yet\s+)?(?:\w+\s+){0,2}$/i;

export function claimsBriefReady(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  const match = CLAIMS_BRIEF_READY.exec(value);
  if (!match) return false;
  const before = value.slice(Math.max(0, match.index - 30), match.index);
  return !NOT_A_CLAIM.test(before);
}
