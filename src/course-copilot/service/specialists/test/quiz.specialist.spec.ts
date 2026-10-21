import { validateTrackItemContent } from 'src/track/service/track-structure.validator';
import { TrackItemType } from 'src/track/type/track.type';
import { QuizSpecialist, summariseQuiz } from '../quiz.specialist';
import { SpecialistValidationError } from '../specialist.types';
import {
  collectIds,
  expectAllUuids,
  fakeLlm,
  makeBlueprint,
  makeContext,
} from './specialist-test.fixtures';

const options = [
  { id: 'a', text: 'Give advice straight away' },
  { id: 'b', text: 'Reflect what you heard' },
  { id: 'c', text: 'Share a story of your own' },
];

/** One of every type, written the sloppy ways models write them. */
const MESSY_QUIZ = {
  questions: [
    // Single-answer keyed by option text.
    {
      id: 'q1',
      type: 'multiple_choice',
      prompt: 'First move?',
      options,
      correctOptionIds: 'Reflect what you heard',
      explanation: 'Reflect first.',
    },
    // "Single" keyed with two answers → becomes select-all.
    {
      id: 'q1',
      type: 'mcq_single',
      prompt: 'Which help?',
      options,
      correctOptionIds: ['b', 'c'],
      explanation: 'Both.',
    },
    {
      id: 'q3',
      type: 'True/False',
      prompt: 'Reassure early.',
      correctAnswer: 'false',
      explanation: 'It closes the conversation.',
    },
    // Items listed in order; no correctOrder given.
    {
      id: 'q4',
      type: 'ordering',
      prompt: 'Put in order.',
      items: [
        { id: 'x', text: 'Greet' },
        { id: 'y', text: 'Reflect' },
        { id: 'z', text: 'Ask' },
      ],
      explanation: 'Rapport first.',
    },
    // Pairs-only matching.
    {
      id: 'q5',
      type: 'matching',
      prompt: 'Match.',
      pairs: [
        { left: 'Open question', right: 'How has today been?' },
        { left: 'Closed question', right: 'Are you okay?' },
      ],
      explanation: 'Open invites more.',
    },
    {
      id: 'q6',
      type: 'fill_blank',
      prompt: '',
      template: 'Before advice, {{b1}} the feeling.',
      blanks: [{ id: 'b1', acceptedAnswers: ['reflect', 'name'] }],
    },
    {
      id: 'q7',
      type: 'open_ended',
      prompt: 'A texter says "whatever". What do you write?',
      minWords: 30,
      rubric: {
        guidance: 'Strong answers name the feeling and invite more.',
        criteria: [
          'Names the feeling',
          { name: 'Asks one open question', weight: 0.5 },
        ],
        maxScore: 10,
      },
    },
    // Not asked for: dropped silently.
    {
      id: 'q8',
      type: 'likert_scale',
      prompt: 'Rate yourself',
      statements: ['I can reflect'],
      scale: ['Low', 'High'],
    },
  ],
};

describe('QuizSpecialist', () => {
  it('normalises every question type into valid QUIZ content with re-minted ids', async () => {
    const llm = fakeLlm(['```json\n' + JSON.stringify(MESSY_QUIZ) + '\n```']);
    const output = await new QuizSpecialist(llm.service).generate(
      makeContext('qz-1'),
    );
    const content = output.content as any;

    expect(() =>
      validateTrackItemContent({
        type: TrackItemType.QUIZ,
        content,
        title: 'Q',
      }),
    ).not.toThrow();
    expectAllUuids(collectIds(content));
    expect(content.settings).toEqual({
      passScore: 80,
      maxAttempts: null,
      shuffleQuestions: true,
      shuffleOptions: true,
      showExplanations: 'after_submit',
    });

    const [single, multi, trueFalse, ordering, matching, blank, open] =
      content.questions;
    expect(content.questions).toHaveLength(7);
    expect(single.type).toBe('mcq_single');
    expect(single.correctOptionIds).toEqual([single.options[1].id]);
    expect(multi.type).toBe('mcq_multi');
    expect(multi.correctOptionIds).toEqual([
      multi.options[1].id,
      multi.options[2].id,
    ]);
    expect(trueFalse.correctAnswer).toBe(false);
    expect(ordering.correctOrder).toEqual(
      ordering.items.map((entry: any) => entry.id),
    );
    expect(matching.correctPairs).toEqual([
      { leftId: matching.left[0].id, rightId: matching.right[0].id },
      { leftId: matching.left[1].id, rightId: matching.right[1].id },
    ]);
    expect(blank.template).toBe(
      `Before advice, {{${blank.blanks[0].id}}} the feeling.`,
    );
    expect(blank.prompt).toBe('Fill in the blank.');
    expect(open.rubric.criteria).toEqual([
      { name: 'Names the feeling' },
      { name: 'Asks one open question', weight: 0.5 },
    ]);
    for (const question of content.questions)
      expect(question.isGraded).toBeUndefined();

    expect(output.summary).toBe(
      '7 questions (2 multiple choice, 1 true/false, 1 matching, 1 ordering, 1 fill in the blank, 1 written)',
    );
  });

  it('keeps a self-rating only when the spec asks for one, and never grades it', async () => {
    const blueprint = makeBlueprint();
    blueprint.sections[0].items[4].spec = {
      questionCount: 2,
      includeSelfRating: true,
    };
    const llm = fakeLlm(
      [
        {
          questions: [
            {
              id: 'q1',
              type: 'mcq_single',
              prompt: 'P?',
              options,
              correctOptionIds: ['b'],
              explanation: 'E.',
            },
            {
              id: 'q2',
              type: 'likert',
              prompt: '',
              statements: [{ id: 's', text: 'I can reflect' }],
              scale: [],
            },
          ],
        },
      ],
      'Rating: {{likert_instruction}}',
    );
    const output = await new QuizSpecialist(llm.service).generate(
      makeContext('qz-1', {}, blueprint),
    );
    const likert = (output.content as any).questions[1];
    expect(likert.type).toBe('likert_scale');
    expect(likert.isGraded).toBe(false);
    expect(likert.scale).toHaveLength(5);
    expect(likert.prompt).toBeTruthy();
    expect(llm.promptOf(0)).toContain(
      'Finish with ONE likert_scale self-rating question',
    );
  });

  it('defaults passScore to 70 and passes the literal blank token through a variable', async () => {
    const blueprint = makeBlueprint();
    delete blueprint.sections[0].items[4].completionCriteria;
    const llm = fakeLlm(
      [
        {
          questions: [
            {
              id: 'q',
              type: 'true_false',
              prompt: 'S.',
              correctAnswer: true,
              explanation: 'E.',
            },
          ],
        },
      ],
      'Use {{blank_token_example}} for blanks. Count {{question_count}}.',
    );
    const output = await new QuizSpecialist(llm.service).generate(
      makeContext('qz-1', {}, blueprint),
    );
    expect((output.content as any).settings.passScore).toBe(70);
    expect(llm.promptOf(0)).toBe('Use {{b1}} for blanks. Count 6.');
    expect(output.summary).toBe('1 question (all true/false)');
  });

  it('collects every broken question as a repair error', async () => {
    const llm = fakeLlm([
      {
        questions: [
          {
            id: 'q1',
            type: 'mcq_single',
            prompt: 'No key?',
            options,
            explanation: 'E.',
          },
          {
            id: 'q2',
            type: 'mcq_single',
            prompt: 'No explanation?',
            options,
            correctOptionIds: ['a'],
          },
          {
            id: 'q3',
            type: 'open_ended',
            prompt: 'Write.',
            rubric: { guidance: 'G', criteria: ['Only one'] },
          },
          { id: 'q4', type: 'drag_and_drop', prompt: 'Huh' },
          {
            id: 'q5',
            type: 'fill_blank',
            template: 'No token here.',
            blanks: [{ id: 'b1', acceptedAnswers: ['x'] }],
          },
        ],
      },
    ]);
    const error = await new QuizSpecialist(llm.service)
      .generate(makeContext('qz-1'))
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(SpecialistValidationError);
    expect(error.errors).toEqual([
      expect.stringMatching(/Question 1 .*no correct option/),
      expect.stringMatching(/Question 2 .*needs an explanation/),
      expect.stringMatching(
        /Question 3 is open-ended and needs 2-4 rubric criteria/,
      ),
      expect.stringMatching(/Question 4 has an unknown type "drag_and_drop"/),
      expect.stringMatching(/Question 5: the template must mark each blank/),
    ]);
  });

  it('drops still-broken questions on the repair pass when a valid one remains', async () => {
    const llm = fakeLlm([
      {
        questions: [
          { id: 'q1', type: 'mcq_single', prompt: 'No key?', options },
          {
            id: 'q2',
            type: 'mcq_single',
            prompt: 'Fine?',
            options,
            correctOptionIds: ['a'],
          },
        ],
      },
    ]);
    const output = await new QuizSpecialist(llm.service).generate(
      makeContext('qz-1', {
        repairErrors: ['Question 1 has no correct option.'],
      }),
    );
    expect((output.content as any).questions).toHaveLength(1);
    expect(llm.promptOf(0)).toContain('- Question 1 has no correct option.');
  });

  it('fails when nothing usable comes back', async () => {
    const llm = fakeLlm([{ questions: [] }]);
    await expect(
      new QuizSpecialist(llm.service).generate(makeContext('qz-1')),
    ).rejects.toThrow('The quiz has no usable questions.');
  });

  it('clamps to the copilot question limit', async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      id: 'q',
      type: 'true_false',
      prompt: `Statement ${index}`,
      correctAnswer: index % 2 === 0,
      explanation: 'E.',
    }));
    const llm = fakeLlm([{ questions: many }]);
    const output = await new QuizSpecialist(llm.service).generate(
      makeContext('qz-1'),
    );
    expect((output.content as any).questions).toHaveLength(20);
  });
});

describe('summariseQuiz', () => {
  it('reads like the build panel expects', () => {
    const questions = [
      ...Array(5).fill({ type: 'mcq_single' }),
      ...Array(2).fill({ type: 'open_ended' }),
    ];
    expect(summariseQuiz(questions as any)).toBe(
      '7 questions (5 multiple choice, 2 written)',
    );
  });
});
