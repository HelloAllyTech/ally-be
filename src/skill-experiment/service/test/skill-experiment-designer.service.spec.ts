import {
  DesignerContext,
  SkillExperimentDesignerService,
  validateDraft,
} from '../skill-experiment-designer.service';

const ORIGINAL = 'Write a debrief.\n{chat_history}\n{SUPERVISOR_NOTE_SECTION}';

const context = (): DesignerContext => ({
  experimentId: 'exp-1',
  skill: { name: 'Debrief', description: '', outputDescription: '' },
  rubric: [{ key: 'tone', name: 'Tone', description: 'Warm', weight: 1 }],
  targetScore: 85,
  originalText: ORIGINAL,
  currentBest: {
    label: 'Original',
    text: ORIGINAL,
    meanScore: 60,
    criterionMeans: { tone: 2.5 },
  },
  lowScoringExamples: [],
  triedBefore: [],
  model: null,
});

describe('validateDraft', () => {
  it('accepts a draft that keeps every placeholder', () => {
    expect(
      validateDraft(
        context(),
        'Write a warm, specific debrief.\n{chat_history}\n{SUPERVISOR_NOTE_SECTION}',
      ),
    ).toEqual([]);
  });

  it('rejects a draft that drops a placeholder', () => {
    expect(
      validateDraft(context(), 'Write a warm debrief about {chat_history}.'),
    ).toEqual([expect.stringContaining('{SUPERVISOR_NOTE_SECTION}')]);
  });

  it('rejects a draft identical to the current best', () => {
    expect(validateDraft(context(), `  ${ORIGINAL}  `)).toEqual([
      expect.stringMatching(/identical/),
    ]);
  });

  it('rejects a draft that cut most of the text', () => {
    const long = {
      ...context(),
      currentBest: {
        ...context().currentBest,
        text: ORIGINAL + 'x'.repeat(500),
      },
    };
    expect(
      validateDraft(long, '{chat_history}{SUPERVISOR_NOTE_SECTION}'),
    ).toEqual([expect.stringMatching(/too much was cut/)]);
  });
});

describe('SkillExperimentDesignerService', () => {
  const reply = (revisedPrompt: string) => ({
    text: JSON.stringify({
      revisedPrompt,
      changeSummary: 'Warmer.',
      hypothesis: 'Tone scores rise.',
    }),
    model: 'designer-1',
  });

  it('feeds a rejected draft’s errors into the next attempt and returns the first valid one', async () => {
    const llm = {
      complete: jest
        .fn()
        .mockResolvedValueOnce(reply('Warm debrief about {chat_history}.'))
        .mockResolvedValueOnce(
          reply('Warm debrief.\n{chat_history}\n{SUPERVISOR_NOTE_SECTION}'),
        ),
    };
    const service = new SkillExperimentDesignerService(
      { getPromptByCode: jest.fn(async () => 'SYSTEM') } as any,
      llm as any,
    );

    const result = await service.draft(context());

    expect(result).toMatchObject({
      ok: true,
      changeSummary: 'Warmer.',
      model: 'designer-1',
    });
    const second = JSON.parse(llm.complete.mock.calls[1][0].prompt);
    expect(second.previousAttemptErrors).toEqual([
      expect.stringContaining('{SUPERVISOR_NOTE_SECTION}'),
    ]);
    expect(second.lockedPlaceholders).toEqual([
      '{SUPERVISOR_NOTE_SECTION}',
      '{chat_history}',
    ]);
  });

  it('gives up after the last attempt and returns the errors and the last draft', async () => {
    const llm = {
      complete: jest
        .fn()
        .mockResolvedValue(reply('Warm debrief about {chat_history}.')),
    };
    const service = new SkillExperimentDesignerService(
      { getPromptByCode: jest.fn(async () => 'SYSTEM') } as any,
      llm as any,
    );

    const result = await service.draft(context());

    expect(llm.complete).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      ok: false,
      lastContent: 'Warm debrief about {chat_history}.',
    });
  });
});
