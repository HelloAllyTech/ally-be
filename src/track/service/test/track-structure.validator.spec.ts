import { BadRequestException } from '@nestjs/common';
import {
  computeStructuralSignature,
  validateTrackStructure,
} from '../track-structure.validator';
import { TrackItemType } from '../../type/track.type';
import { UpsertTrackSectionDto } from '../../dto/upsert-track-structure.dto';

function baseSections(): UpsertTrackSectionDto[] {
  return [
    {
      title: 'Section 1',
      order: 1,
      items: [
        {
          type: TrackItemType.ARTICLE,
          order: 1,
          title: 'Article',
          content: { html: '<p>hi</p>' },
        },
        {
          type: TrackItemType.ROLEPLAY,
          order: 2,
          title: 'Roleplay',
          scenarioId: 1,
        },
      ],
    },
  ];
}

function gameItem(overrides: Record<string, any> = {}) {
  return {
    type: TrackItemType.GAME,
    order: 1,
    title: 'Breather',
    content: { gameKey: 'TREX_RUNNER', intro: 'Shake that call off.' },
    ...overrides,
  };
}

function quizItem(overrides: Record<string, any> = {}) {
  return {
    type: TrackItemType.QUIZ,
    order: 1,
    title: 'Quiz',
    content: {
      settings: { passScore: 70 },
      questions: [
        {
          id: 'q1',
          type: 'mcq_single',
          prompt: 'Pick',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          correctOptionIds: ['a'],
        },
      ],
      ...overrides,
    },
  } as any;
}

describe('validateTrackStructure', () => {
  it('accepts a valid tree', () => {
    expect(() => validateTrackStructure(baseSections())).not.toThrow();
  });

  it('rejects non-sequential section orders', () => {
    const sections = baseSections();
    sections[0].order = 3;
    expect(() => validateTrackStructure(sections)).toThrow(BadRequestException);
  });

  it('rejects duplicate item orders within a section', () => {
    const sections = baseSections();
    sections[0].items[1].order = 1;
    expect(() => validateTrackStructure(sections)).toThrow(BadRequestException);
  });

  it('rejects a roleplay item without a scenario', () => {
    const sections = baseSections();
    delete sections[0].items[1].scenarioId;
    expect(() => validateTrackStructure(sections)).toThrow(
      /must reference a scenario/,
    );
  });

  it('rejects an empty article', () => {
    const sections = baseSections();
    sections[0].items[0].content = { html: '   ' };
    expect(() => validateTrackStructure(sections)).toThrow(/must have content/);
  });

  it('rejects a quiz whose correct option id is unknown', () => {
    const sections: UpsertTrackSectionDto[] = [
      {
        title: 'S',
        order: 1,
        items: [quizItem()],
      },
    ];
    (sections[0].items[0].content as any).questions[0].correctOptionIds = [
      'zzz',
    ];
    expect(() => validateTrackStructure(sections)).toThrow(/correct option id/);
  });

  it('rejects a fill-blank template missing its token', () => {
    const sections: UpsertTrackSectionDto[] = [
      { title: 'S', order: 1, items: [quizItem()] },
    ];
    (sections[0].items[0].content as any).questions = [
      {
        id: 'q1',
        type: 'fill_blank',
        prompt: '',
        template: 'no token here',
        blanks: [{ id: 'b1', acceptedAnswers: ['x'] }],
      },
    ];
    expect(() => validateTrackStructure(sections)).toThrow(/token/);
  });

  it('rejects an ordering question whose correctOrder is not a permutation', () => {
    const sections: UpsertTrackSectionDto[] = [
      { title: 'S', order: 1, items: [quizItem()] },
    ];
    (sections[0].items[0].content as any).questions = [
      {
        id: 'q1',
        type: 'ordering',
        prompt: 'Order',
        items: [
          { id: 'i1', text: '1' },
          { id: 'i2', text: '2' },
        ],
        correctOrder: ['i1', 'i1'],
      },
    ];
    expect(() => validateTrackStructure(sections)).toThrow(/permutation/);
  });
});

describe('computeStructuralSignature', () => {
  it('is stable across content-safe edits', () => {
    const before = baseSections();
    before[0].id = 's1';
    before[0].items[0].id = 'i1';
    before[0].items[1].id = 'i2';
    const after = JSON.parse(JSON.stringify(before));
    after[0].title = 'Renamed section';
    after[0].items[0].title = 'Renamed article';
    after[0].items[0].content = { html: '<p>rewritten body</p>' };
    expect(computeStructuralSignature(after)).toEqual(
      computeStructuralSignature(before),
    );
  });

  it('changes when items are reordered', () => {
    const before = baseSections();
    before[0].id = 's1';
    before[0].items[0].id = 'i1';
    before[0].items[1].id = 'i2';
    const after = JSON.parse(JSON.stringify(before));
    after[0].items[0].order = 2;
    after[0].items[1].order = 1;
    expect(computeStructuralSignature(after)).not.toEqual(
      computeStructuralSignature(before),
    );
  });

  it('changes when a quiz answer key changes', () => {
    const before: UpsertTrackSectionDto[] = [
      { id: 's1', title: 'S', order: 1, items: [{ ...quizItem(), id: 'i1' }] },
    ];
    const after = JSON.parse(JSON.stringify(before));
    after[0].items[0].content.questions[0].correctOptionIds = ['b'];
    expect(computeStructuralSignature(after)).not.toEqual(
      computeStructuralSignature(before),
    );
  });

  it('is stable when only a question explanation changes', () => {
    const before: UpsertTrackSectionDto[] = [
      { id: 's1', title: 'S', order: 1, items: [{ ...quizItem(), id: 'i1' }] },
    ];
    const after = JSON.parse(JSON.stringify(before));
    after[0].items[0].content.questions[0].explanation = 'new explanation';
    expect(computeStructuralSignature(after)).toEqual(
      computeStructuralSignature(before),
    );
  });

  it('changes when the game an item runs is swapped', () => {
    const before: UpsertTrackSectionDto[] = [
      { id: 's1', title: 'S', order: 1, items: [{ ...gameItem(), id: 'i1' }] },
    ];
    const after = JSON.parse(JSON.stringify(before));
    after[0].items[0].content.gameKey = 'SOMETHING_ELSE';
    expect(computeStructuralSignature(after)).not.toEqual(
      computeStructuralSignature(before),
    );
  });

  it('is stable when only the game intro changes', () => {
    const before: UpsertTrackSectionDto[] = [
      { id: 's1', title: 'S', order: 1, items: [{ ...gameItem(), id: 'i1' }] },
    ];
    const after = JSON.parse(JSON.stringify(before));
    after[0].items[0].content.intro = 'Reworded framing.';
    expect(computeStructuralSignature(after)).toEqual(
      computeStructuralSignature(before),
    );
  });
});

describe('validateTrackStructure - game', () => {
  const wrap = (item: any): UpsertTrackSectionDto[] => [
    { title: 'S', order: 1, items: [item] },
  ];

  it('accepts a game with a known key', () => {
    expect(() => validateTrackStructure(wrap(gameItem()))).not.toThrow();
  });

  it('accepts a game with no intro at all', () => {
    expect(() =>
      validateTrackStructure(
        wrap(gameItem({ content: { gameKey: 'TREX_RUNNER' } })),
      ),
    ).not.toThrow();
  });

  it('rejects a game with no game selected', () => {
    expect(() =>
      validateTrackStructure(wrap(gameItem({ content: {} }))),
    ).toThrow(BadRequestException);
  });

  it('rejects a game key the learner app cannot serve', () => {
    expect(() =>
      validateTrackStructure(wrap(gameItem({ content: { gameKey: 'PONG' } }))),
    ).toThrow(BadRequestException);
  });

  it('never carries a completion threshold — games do not gate', () => {
    // Guards the product rule in game.type.ts: an author cannot smuggle a
    // score gate in through completionCriteria, because nothing reads it.
    const item = gameItem({ completionCriteria: { minScore: 500 } });
    expect(() => validateTrackStructure(wrap(item))).not.toThrow();
  });
});
