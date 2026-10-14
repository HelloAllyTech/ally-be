import { readFileSync } from 'fs';
import { join } from 'path';
import { NotFoundException } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_PROMPTS,
} from '../../../constants/course-copilot.constants';
import {
  CourseBlueprint,
  CourseBlueprintItem,
} from '../../../type/course-copilot.type';
import {
  RoleplayBriefSpecialist,
  difficultyFromTaskClass,
} from '../roleplay-brief.specialist';
import {
  SpecialistContext,
  SpecialistValidationError,
} from '../specialist.types';

/** The real prompt file, so a renamed or dropped variable shows up here. */
const TEMPLATE = readFileSync(
  join(process.cwd(), 'src/prompts/course_copilot/roleplay_brief.txt'),
  'utf8',
);

const BRIEF_TEXT =
  'Meera Joshi is a 29-year-old staff nurse on a run of night shifts at a ' +
  'district hospital in Pune. She has called the staff wellbeing line after ' +
  'missing two shifts. She is guarded, apologises a lot, and changes the ' +
  'subject when asked how she is sleeping. She opens up when the helper ' +
  'reflects how tired she sounds, and goes quiet if given advice.';

const roleplayItem = (
  id: string,
  taskClass: string,
  extra: Partial<CourseBlueprintItem> = {},
): CourseBlueprintItem => ({
  id,
  type: 'ROLEPLAY',
  title: `Practice ${id}`,
  purpose: 'Practise reflecting feelings',
  objectiveRefs: [1],
  estimatedMinutes: 12,
  source: { kind: 'new' },
  spec: { taskClass, personaBrief: 'A night-shift nurse' },
  ...extra,
});

const makeContext = (
  taskClass: string,
  overrides: Partial<SpecialistContext> = {},
): SpecialistContext => {
  const item = roleplayItem('rp-2', taskClass, {
    spec: {
      taskClass,
      personaBrief: 'A night-shift nurse',
      triggerWarningIds: ['tw-1'],
    },
  });
  const section = {
    id: 'sec-1',
    title: 'Listening under pressure',
    description: 'd',
    purpose: 'Practise reflection with harder callers',
    items: [roleplayItem('rp-1', 'cooperative, one concern'), item],
  };
  const blueprint = {
    title: 'Supporting tired colleagues',
    description: 'd',
    estimatedDurationMinutes: 60,
    competencyIds: ['c1'],
    cover: { mode: 'upload-later' },
    sections: [section],
    estimate: { usd: 1, minutes: 60, items: 2, newRoleplays: 2, images: 0 },
  } as CourseBlueprint;
  return {
    sessionId: 'session-1',
    brief: {
      audience: {
        who: 'Peer-support volunteers in hospitals',
        priorExperience: 'Basic listening course',
        applicationContext: 'Staff wellbeing phone line',
      },
      outcomes: {
        terminal: 'Hold a supportive call with a struggling colleague',
        enabling: ['Open the call', 'Reflect feelings accurately'],
      },
      competencyNames: ['Empathic reflection'],
      behaviours: {
        helpful: ['Reflecting feelings'],
        unhelpful: ['Giving premature advice'],
      },
      notes: ['Keep it grounded in Indian hospitals'],
    },
    blueprint,
    section,
    item,
    usageMetadata: { courseCopilotSessionId: 'session-1', jobId: 'job-9' },
    ...overrides,
  };
};

const answer = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: 'Night-shift nurse doubting herself',
    actorDescription: BRIEF_TEXT,
    agentTestCases: 'Opens up after a reflection, Goes quiet when advised',
    personaGender: 'female',
    personaAge: 29,
    difficulty: 'MEDIUM',
    ...overrides,
  });

describe('RoleplayBriefSpecialist', () => {
  let getPromptByCode: jest.Mock;
  let complete: jest.Mock;
  let specialist: RoleplayBriefSpecialist;

  const renderedPrompt = (): string => complete.mock.calls[0][0].prompt;

  beforeEach(() => {
    getPromptByCode = jest.fn().mockResolvedValue(TEMPLATE);
    complete = jest.fn().mockResolvedValue({ text: answer() });
    specialist = new RoleplayBriefSpecialist(
      { getPromptByCode } as any,
      { complete } as any,
    );
  });

  it('renders the slot into the prompt and calls the registered task in JSON mode', async () => {
    const ctx = makeContext('guarded, ambivalent caller');

    await specialist.write(ctx);

    expect(getPromptByCode).toHaveBeenCalledWith(
      COURSE_COPILOT_PROMPTS.ROLEPLAY_BRIEF,
    );
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: COURSE_COPILOT_AI_TASKS.ROLEPLAY_BRIEF,
        task: LlmTask.COURSE_COPILOT_ROLEPLAY_BRIEF,
        promptCode: COURSE_COPILOT_PROMPTS.ROLEPLAY_BRIEF,
        jsonMode: true,
        usageMetadata: ctx.usageMetadata,
      }),
    );
    const prompt = renderedPrompt();
    expect(prompt).not.toMatch(/\{\{\s*\w+\s*\}\}/);
    expect(prompt).toContain('Peer-support volunteers in hospitals');
    expect(prompt).toContain('Staff wellbeing phone line');
    expect(prompt).toContain('Reflect feelings accurately');
    expect(prompt).not.toContain('Open the call;');
    expect(prompt).toContain('Giving premature advice');
    expect(prompt).toContain('guarded, ambivalent caller');
    expect(prompt).toContain('A night-shift nurse');
    // The progression, with this slot marked.
    expect(prompt).toContain(
      '   Practice rp-1 — task class: cooperative, one concern',
    );
    expect(prompt).toContain(
      '>> Practice rp-2 — task class: guarded, ambivalent caller',
    );
    expect(prompt).toContain(
      'allowed — this roleplay carries trigger warnings',
    );
    // The JSON contract's placeholders survive rendering.
    expect(prompt).toContain('"title": "<title>"');
  });

  it('returns the chain inputs', async () => {
    const result = await specialist.write(makeContext('guarded, ambivalent'));

    expect(result).toEqual({
      actorDescription: BRIEF_TEXT,
      agentTestCases: 'Opens up after a reflection, Goes quiet when advised',
      personaGender: 'female',
      personaAge: 29,
      title: 'Night-shift nurse doubting herself',
      difficultyLevel: 'MEDIUM',
    });
  });

  it('follows the task class over the model when they disagree', async () => {
    complete.mockResolvedValue({ text: answer({ difficulty: 'HARD' }) });

    const result = await specialist.write(
      makeContext('cooperative caller, one concern'),
    );

    expect(result.difficultyLevel).toBe('EASY');
  });

  it("uses the model's reading when the task class names neither axis, else MEDIUM", async () => {
    complete.mockResolvedValue({ text: answer({ difficulty: 'HARD' }) });
    expect(
      (await specialist.write(makeContext('late at night'))).difficultyLevel,
    ).toBe('HARD');

    complete.mockResolvedValue({ text: answer({ difficulty: 'IMPOSSIBLE' }) });
    expect(
      (await specialist.write(makeContext('late at night'))).difficultyLevel,
    ).toBe('MEDIUM');
  });

  it('repairs what it can: list test cases, bad gender and age, quoted long title', async () => {
    complete.mockResolvedValue({
      text:
        '```json\n' +
        answer({
          agentTestCases: ['Opens up after a reflection', ' ', 'Goes quiet'],
          personaGender: 'woman',
          personaAge: 7,
          title: `"${'A'.repeat(140)}"`,
        }) +
        '\n```',
    });

    const result = await specialist.write(makeContext('ambivalent'));

    expect(result.agentTestCases).toBe(
      'Opens up after a reflection, Goes quiet',
    );
    expect(result).not.toHaveProperty('personaGender');
    expect(result).not.toHaveProperty('personaAge');
    expect(result.title).toHaveLength(100);
    expect(result.title.startsWith('"')).toBe(false);
  });

  it('throws a validation error listing every problem for the repair pass', async () => {
    complete.mockResolvedValue({
      text: answer({
        actorDescription: 'Too short.',
        title: '',
        agentTestCases: '',
      }),
    });

    const error = await specialist
      .write(makeContext('ambivalent'))
      .catch((e) => e);

    expect(error).toBeInstanceOf(SpecialistValidationError);
    expect(error.errors).toHaveLength(3);
    expect(error.errors.join(' ')).toMatch(
      /actorDescription.*title.*agentTestCases/,
    );
  });

  it('feeds repair errors and a regeneration request back into the prompt', async () => {
    await specialist.write(
      makeContext('ambivalent', {
        repairErrors: ['title is missing'],
        previous: {
          content: { title: 'Old title' },
          instructions: 'Make her a paramedic',
        },
      }),
    );

    const prompt = renderedPrompt();
    expect(prompt).toContain('- title is missing');
    expect(prompt).toContain('Make her a paramedic');
    expect(prompt).toContain('"title":"Old title"');
  });

  it('fails clearly when the prompt row is missing', async () => {
    getPromptByCode.mockResolvedValue(null);

    await expect(specialist.write(makeContext('ambivalent'))).rejects.toThrow(
      NotFoundException,
    );
    await expect(specialist.write(makeContext('ambivalent'))).rejects.toThrow(
      COURSE_COPILOT_PROMPTS.ROLEPLAY_BRIEF,
    );
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('difficultyFromTaskClass', () => {
  it.each([
    ['cooperative caller, one concern', 'EASY'],
    ['Cooperative client', 'EASY'],
    ['ambivalent about change', 'MEDIUM'],
    ['guarded and reluctant', 'MEDIUM'],
    ['cooperative, several concerns', 'MEDIUM'],
    ['distressed caller', 'HARD'],
    ['acute distress, one concern', 'HARD'],
    ['ambivalent, two competing concerns', 'HARD'],
    ['no longer cooperative, now distressed', 'HARD'],
  ])('%s → %s', (taskClass, expected) => {
    expect(difficultyFromTaskClass(taskClass)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    undefined,
    'late at night',
    'works in a network hospital',
  ])('names neither axis: %p → null', (taskClass) => {
    expect(difficultyFromTaskClass(taskClass)).toBeNull();
  });
});
