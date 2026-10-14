import { validate as isUuid } from 'uuid';
import { courseCopilotGameOptions } from '../../../util/course-blueprint.util';
import { BlueprintPlannerSpecialist } from '../blueprint-planner.specialist';
import { BlueprintPlannerInput } from '../specialist.types';
import { fakeLlm, makeBrief } from './specialist-test.fixtures';

const input = (): BlueprintPlannerInput => ({
  sessionId: 'session-1',
  brief: makeBrief(),
  notes: 'Keep it to two sections.',
  libraryPicks: [
    { scenarioId: 42, title: 'Asha goes quiet', competency: 'Listening' },
  ],
  games: courseCopilotGameOptions(),
  usageMetadata: { courseCopilotSessionId: 'session-1' },
});

const goodPlan = {
  title: 'Staying with the texter',
  description: 'Two sentences.',
  sections: [
    {
      id: 's1',
      title: 'A cooperative texter',
      description: 'One concern.',
      purpose: 'Simplest task class',
      items: [
        {
          id: 'i1',
          type: 'ARTICLE',
          title: 'Name the feeling',
          purpose: 'p',
          objectiveRefs: [0],
          estimatedMinutes: 6,
          source: { kind: 'new' },
          spec: { outline: ['a'] },
        },
        {
          id: 'i2',
          type: 'ROLEPLAY',
          title: 'Asha',
          purpose: 'p',
          objectiveRefs: [0, 1],
          source: { kind: 'library', scenarioId: 42 },
          spec: { slot: 1 },
        },
        {
          id: 'i3',
          type: 'JOURNAL',
          title: 'Looking back',
          purpose: 'p',
          objectiveRefs: [],
          source: { kind: 'new' },
          spec: {},
        },
      ],
    },
  ],
};

const endsOnGame = {
  ...goodPlan,
  sections: [
    {
      ...goodPlan.sections[0],
      items: [
        ...goodPlan.sections[0].items,
        {
          id: 'i4',
          type: 'GAME',
          title: 'Breather',
          purpose: 'p',
          objectiveRefs: [],
          source: { kind: 'new' },
          spec: { gameKey: 'SNAKE' },
        },
      ],
    },
  ],
};

describe('BlueprintPlannerSpecialist', () => {
  it('returns a normalised blueprint from one call when it has no problems', async () => {
    const llm = fakeLlm(
      [goodPlan],
      'Notes: {{trainer_notes}}\nObjectives:\n{{objectives_list}}\nGames: {{games_json}}\nMax new {{max_new_roleplays}}',
    );
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      input(),
    );

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(llm.complete.mock.calls[0][0]).toMatchObject({
      promptCode: 'course_copilot_blueprint_planner',
      taskId: 'course-copilot-blueprint',
      jsonMode: true,
      usageMetadata: {
        courseCopilotSessionId: 'session-1',
        specialist: 'blueprint_planner',
      },
    });
    const prompt = llm.promptOf(0);
    expect(prompt).toContain('Notes: Keep it to two sections.');
    expect(prompt).toContain('0: Reflect the feeling behind a message');
    expect(prompt).toContain('"key": "TREX_RUNNER"');
    expect(prompt).toContain('Max new 4');

    expect(blueprint.sections[0].items.map((entry) => entry.type)).toEqual([
      'ARTICLE',
      'ROLEPLAY',
      'JOURNAL',
    ]);
    expect(blueprint.sections[0].items.every((entry) => isUuid(entry.id))).toBe(
      true,
    );
    // Slot 1 has no minScore and the roleplay is the capstone → assessment threshold.
    expect(blueprint.sections[0].items[1].completionCriteria).toEqual({
      minScore: 65,
    });
    expect(blueprint.estimatedDurationMinutes).toBe(6 + 12 + 4);
    expect(blueprint.competencyIds).toEqual(['c-1', 'c-2']);
  });

  it('makes one repair call with the problems and keeps the better plan', async () => {
    const llm = fakeLlm([endsOnGame, goodPlan]);
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      input(),
    );
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.promptOf(1)).toContain(
      'Your previous output was rejected for these reasons:',
    );
    expect(llm.promptOf(1)).toContain("The course ends on a game ('Breather')");
    expect(blueprint.sections[0].items).toHaveLength(3);
  });

  it('keeps the first plan when the repair is no better', async () => {
    const llm = fakeLlm([endsOnGame, endsOnGame]);
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      input(),
    );
    expect(blueprint.sections[0].items).toHaveLength(4);
  });

  it('keeps the first plan when the repair returns no JSON', async () => {
    const llm = fakeLlm([endsOnGame, 'sorry']);
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      input(),
    );
    expect(blueprint.sections[0].items).toHaveLength(4);
  });

  it('spends its one retry on unparseable output', async () => {
    const llm = fakeLlm(['not json', goodPlan]);
    const blueprint = await new BlueprintPlannerSpecialist(llm.service).plan(
      input(),
    );
    expect(llm.promptOf(1)).toContain('- The model did not return JSON');
    expect(blueprint.sections).toHaveLength(1);
  });

  it('honours a configured new-roleplay ceiling', async () => {
    const twoNew = {
      ...goodPlan,
      sections: [
        {
          ...goodPlan.sections[0],
          items: [
            {
              id: 'a',
              type: 'ROLEPLAY',
              title: 'One',
              purpose: 'p',
              source: { kind: 'new' },
              spec: {},
            },
            {
              id: 'b',
              type: 'ROLEPLAY',
              title: 'Two',
              purpose: 'p',
              source: { kind: 'new' },
              spec: {},
            },
            {
              id: 'c',
              type: 'JOURNAL',
              title: 'Three',
              purpose: 'p',
              source: { kind: 'new' },
              spec: {},
            },
          ],
        },
      ],
    };
    const llm = fakeLlm([twoNew, twoNew]);
    await new BlueprintPlannerSpecialist(llm.service).plan(input(), {
      maxNewRoleplays: 1,
    });
    expect(llm.promptOf(1)).toContain('one course can create at most 1');
  });
});
