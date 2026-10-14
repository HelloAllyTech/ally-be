import { validate as isUuid } from 'uuid';
import {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseBrief,
} from '../../../type/course-copilot.type';
import { SpecialistLlmService } from '../specialist-llm.service';
import { SpecialistContext } from '../specialist.types';

/**
 * Shared fakes for the specialist specs. The LLM is a queue of canned texts —
 * each `complete` call takes the next one — so a spec can script a messy
 * first answer and a clean repair answer.
 */

export const PROMPT_TEMPLATE =
  'PROMPT\nbrief={{brief_json}}\nitem={{item_json}}\nextra={{question_count}}';

export interface FakeLlm {
  service: SpecialistLlmService;
  complete: jest.Mock;
  getPromptByCode: jest.Mock;
  /** The `prompt` string sent on call n (0-based). */
  promptOf(call: number): string;
}

export function fakeLlm(
  responses: (string | Record<string, any>)[],
  template: string | null = PROMPT_TEMPLATE,
): FakeLlm {
  const queue = [...responses];
  const complete = jest.fn().mockImplementation(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('No canned LLM response left');
    return {
      text: typeof next === 'string' ? next : JSON.stringify(next),
      model: 'fake-model',
      provider: 'fake',
      source: 'TIER',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  });
  const getPromptByCode = jest.fn().mockResolvedValue(template);
  const service = new SpecialistLlmService(
    { getPromptByCode } as any,
    { complete } as any,
  );
  return {
    service,
    complete,
    getPromptByCode,
    promptOf: (call) => complete.mock.calls[call][0].prompt as string,
  };
}

export function makeBrief(overrides: Partial<CourseBrief> = {}): CourseBrief {
  return {
    seed: 'Help new text-line volunteers stay with a texter who wants to leave.',
    audience: {
      who: 'Volunteer listeners in their first month on a text helpline',
      priorExperience: 'No counselling background',
      applicationContext: 'Evening text shifts',
    },
    outcomes: {
      terminal:
        'Keep a reluctant texter in the conversation long enough to assess risk',
      enabling: [
        'Reflect the feeling behind a message before responding to its content',
        'Ask one open question at a time',
        'Ask directly about suicide when there are risk cues',
      ],
    },
    competencyIds: ['c-1', 'c-2'],
    behaviours: {
      helpful: [
        'Reflects feelings',
        'Asks open questions',
        'Asks directly about risk',
      ],
      unhelpful: ['Gives advice too early', 'Reassures too quickly'],
    },
    assessment: { kind: 'roleplay', threshold: 65 },
    shape: { durationMinutes: 60, languageIds: ['1'] },
    look: { cover: 'generate', articleImages: 'none' },
    notes: ['Reference sheet: https://example.org/listening-guide'],
    ...overrides,
  };
}

export function item(
  overrides: Partial<CourseBlueprintItem> &
    Pick<CourseBlueprintItem, 'id' | 'type'>,
): CourseBlueprintItem {
  return {
    title: `${overrides.type} item`,
    purpose: 'Purpose line',
    objectiveRefs: [0],
    estimatedMinutes: 5,
    source: { kind: 'new' },
    spec: {},
    ...overrides,
  };
}

/** Section 1: article → annotation → roleplay → journal → quiz. */
export function makeBlueprint(): CourseBlueprint {
  return {
    title: 'Staying with the texter',
    description: 'A short course.',
    estimatedDurationMinutes: 40,
    competencyIds: ['c-1'],
    cover: { mode: 'generate' },
    sections: [
      {
        id: 'sec-1',
        title: 'A cooperative texter',
        description: 'One concern, plenty of time.',
        purpose: 'Simplest task class',
        items: [
          item({
            id: 'art-1',
            type: 'ARTICLE',
            title: 'Name the feeling first',
            spec: { outline: ['Reflect', 'Then ask'], questionCount: 2 },
          }),
          item({
            id: 'ann-1',
            type: 'ANNOTATED_ARTIFACT',
            title: 'A first shift, annotated',
            spec: { focus: 'A texter who goes quiet' },
          }),
          item({
            id: 'rp-1',
            type: 'ROLEPLAY',
            title: 'Asha goes quiet',
            spec: {
              personaBrief: 'Asha, 19, exam stress',
              taskClass: 'Cooperative',
            },
          }),
          item({ id: 'jr-1', type: 'JOURNAL', title: 'Looking back at Asha' }),
          item({
            id: 'qz-1',
            type: 'QUIZ',
            title: 'Check your listening',
            spec: { questionCount: 6 },
            completionCriteria: { passScore: 80 },
          }),
        ],
      },
    ],
    estimate: { usd: 0, minutes: 40, items: 5, newRoleplays: 1, images: 1 },
  };
}

export function makeContext(
  itemId: string,
  overrides: Partial<SpecialistContext> = {},
  blueprint: CourseBlueprint = makeBlueprint(),
): SpecialistContext {
  const section = blueprint.sections.find((candidate) =>
    candidate.items.some((entry) => entry.id === itemId),
  )!;
  return {
    sessionId: 'session-1',
    brief: makeBrief(),
    blueprint,
    section,
    item: section.items.find((entry) => entry.id === itemId)!,
    usageMetadata: { courseCopilotSessionId: 'session-1', jobId: 'job-1' },
    ...overrides,
  };
}

/** Every value of an `id`-like key, for "all ids are uuids" assertions. */
export function collectIds(value: unknown, keys = ['id']): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [key, entry] of Object.entries(node)) {
        if (keys.includes(key) && typeof entry === 'string') out.push(entry);
        else walk(entry);
      }
    }
  };
  walk(value);
  return out;
}

export function expectAllUuids(ids: string[]): void {
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) expect(isUuid(id)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
}

/** About `n` words of filler prose, for articles that must clear the floor. */
export function words(n: number, seed = 'listen'): string {
  return Array.from({ length: n }, (_, index) => `${seed}${index % 7}`).join(
    ' ',
  );
}
