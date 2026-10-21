import { validate as isUuid } from 'uuid';
import { TrackGameKey } from 'src/track/type/game.type';
import {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseBrief,
} from '../../type/course-copilot.type';
import {
  articleWantsImage,
  blueprintWarnings,
  COURSE_COPILOT_GAME_CATALOG,
  countImages,
  countNewCases,
  countNewRoleplays,
  courseCopilotGameOptions,
  normaliseBlueprint,
  validateBlueprint,
} from '../course-blueprint.util';

const brief = (overrides: Partial<CourseBrief> = {}): CourseBrief => ({
  outcomes: { terminal: 'T', enabling: ['A', 'B', 'C'] },
  competencyIds: ['c-1', 'c-2'],
  assessment: { kind: 'roleplay', threshold: 75 },
  look: { cover: 'generate', articleImages: 'none' },
  ...overrides,
});

const rawItem = (type: string, extra: Record<string, any> = {}) => ({
  id: `i-${Math.random().toString(36).slice(2, 7)}`,
  type,
  title: `${type} title`,
  purpose: 'p',
  ...extra,
});

const rawPlan = (
  items: Record<string, any>[],
  extra: Record<string, any> = {},
) => ({
  title: 'Course',
  description: 'Desc',
  sections: [
    { id: 's1', title: 'Section one', description: 'd', purpose: 'p', items },
  ],
  ...extra,
});

const one = (blueprint: CourseBlueprint, index = 0): CourseBlueprintItem =>
  blueprint.sections[0].items[index];

const OPTS = { maxNewRoleplays: 4 };

describe('normaliseBlueprint', () => {
  it('unwraps { blueprint }, replaces model ids with uuids and keeps a caller uuid', () => {
    const kept = '3f2b8c1e-5d4a-4e6f-9b7c-1a2b3c4d5e6f';
    const blueprint = normaliseBlueprint(
      {
        blueprint: rawPlan([
          rawItem('ARTICLE', { id: kept }),
          rawItem('QUIZ', { id: kept }),
          rawItem('JOURNAL', { id: undefined }),
        ]),
      },
      brief(),
    );
    const ids = [
      blueprint.sections[0].id,
      ...blueprint.sections[0].items.map((item) => item.id),
    ];
    expect(ids.every((id) => isUuid(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(one(blueprint, 0).id).toBe(kept);
    expect(one(blueprint, 1).id).not.toBe(kept);
  });

  it('rewrites a new case member ids to the re-minted roleplay ids', () => {
    const blueprint = normaliseBlueprint(
      rawPlan([
        rawItem('ROLEPLAY', { id: 'r1' }),
        rawItem('ROLEPLAY', { id: 'r2' }),
        rawItem('CASE', {
          source: { kind: 'new' },
          spec: { memberItemIds: ['r1', 'r2', 'r2'] },
        }),
      ]),
      brief(),
    );
    expect(one(blueprint, 2).spec.memberItemIds).toEqual([
      one(blueprint, 0).id,
      one(blueprint, 1).id,
    ]);
  });

  it('coerces type aliases and drops unknown types', () => {
    const blueprint = normaliseBlueprint(
      rawPlan([
        rawItem('annotation'),
        rawItem('role play'),
        rawItem('reading'),
        rawItem('POLL'),
        rawItem('annotated-artifact'),
      ]),
      brief(),
    );
    expect(blueprint.sections[0].items.map((item) => item.type)).toEqual([
      'ANNOTATED_ARTIFACT',
      'ROLEPLAY',
      'ARTICLE',
      'ANNOTATED_ARTIFACT',
    ]);
  });

  it('defaults minutes by type and keeps a sensible given value', () => {
    const blueprint = normaliseBlueprint(
      rawPlan([
        rawItem('ARTICLE'),
        rawItem('QUIZ', { estimatedMinutes: 9 }),
        rawItem('CASE', { estimatedMinutes: -3 }),
        rawItem('ROLEPLAY', { estimatedMinutes: 'ten' }),
        rawItem('GAME'),
      ]),
      brief(),
    );
    expect(
      blueprint.sections[0].items.map((item) => item.estimatedMinutes),
    ).toEqual([6, 9, 25, 12, 3]);
    expect(blueprint.estimatedDurationMinutes).toBe(55);
    expect(blueprint.estimate).toEqual({
      usd: 0,
      minutes: 55,
      items: 5,
      newRoleplays: 1,
      images: 1,
    });
  });

  it('keeps only valid objective indexes', () => {
    const blueprint = normaliseBlueprint(
      rawPlan([
        rawItem('QUIZ', { objectiveRefs: [0, '2', 2, 3, -1, 1.5, 'x'] }),
      ]),
      brief(),
    );
    expect(one(blueprint).objectiveRefs).toEqual([0, 2]);
  });

  describe('source', () => {
    it('normalises library roleplays and cases, and makes inline items new', () => {
      const blueprint = normaliseBlueprint(
        rawPlan([
          rawItem('ROLEPLAY', {
            source: { kind: 'library', scenarioId: '42' },
          }),
          rawItem('ROLEPLAY', { spec: { scenarioId: 7 } }),
          rawItem('ROLEPLAY', { source: { kind: 'library' } }),
          rawItem('CASE', { source: { kind: 'library', caseId: 'case-9' } }),
          rawItem('ROLEPLAY'),
          rawItem('QUIZ', { source: { kind: 'library' } }),
          rawItem('QUIZ', { source: { kind: 'library', templateId: 'tpl-1' } }),
        ]),
        brief(),
      );
      expect(blueprint.sections[0].items.map((item) => item.source)).toEqual([
        { kind: 'library', scenarioId: 42 },
        { kind: 'library', scenarioId: 7 },
        { kind: 'library' },
        { kind: 'library', caseId: 'case-9' },
        { kind: 'new' },
        { kind: 'new' },
        { kind: 'library', templateId: 'tpl-1' },
      ]);
    });

    it('keeps a video url, infers its source and takes minutes from its length', () => {
      const blueprint = normaliseBlueprint(
        rawPlan([
          rawItem('VIDEO', {
            spec: { url: 'https://youtu.be/abc', durationSeconds: 430 },
          }),
        ]),
        brief(),
      );
      expect(one(blueprint).source).toEqual({ kind: 'new' });
      expect(one(blueprint).spec).toEqual({
        url: 'https://youtu.be/abc',
        source: 'youtube',
        durationSeconds: 430,
      });
      expect(one(blueprint).estimatedMinutes).toBe(8);
    });

    it('matches a video to the trainer-supplied link by title', () => {
      const blueprint = normaliseBlueprint(
        rawPlan([rawItem('VIDEO', { title: 'Active listening demo' })]),
        brief({
          videoUrls: [
            {
              title: 'Something else',
              url: 'https://vimeo.com/1',
              source: 'vimeo',
            },
            {
              title: 'Active Listening Demo',
              url: 'https://www.loom.com/share/x',
              source: 'loom',
              durationSeconds: 120,
            },
          ],
        }),
      );
      expect(one(blueprint).spec).toEqual({
        url: 'https://www.loom.com/share/x',
        source: 'loom',
        durationSeconds: 120,
      });
      expect(one(blueprint).estimatedMinutes).toBe(2);
    });

    it('matches by index, and assigns the one unused video to the one waiting item', () => {
      const videos = [
        { title: 'A', url: 'https://vimeo.com/1', source: 'vimeo' as const },
        {
          title: 'B',
          url: 'https://cdn.example.com/b.mp4',
          source: 's3' as const,
        },
      ];
      const blueprint = normaliseBlueprint(
        rawPlan([
          rawItem('VIDEO', { title: 'First', spec: { videoIndex: 0 } }),
          rawItem('VIDEO', { title: 'Unrelated title' }),
        ]),
        brief({ videoUrls: videos }),
      );
      expect(one(blueprint, 0).spec.url).toBe('https://vimeo.com/1');
      expect(one(blueprint, 0).spec.videoIndex).toBeUndefined();
      expect(one(blueprint, 1).spec).toEqual({
        url: 'https://cdn.example.com/b.mp4',
        source: 's3',
      });
      expect(one(blueprint, 1).source).toEqual({ kind: 'new' });
    });

    it('marks a video with no link as needing one', () => {
      const blueprint = normaliseBlueprint(
        rawPlan([rawItem('VIDEO', { spec: { url: 'not a url' } })]),
        brief(),
      );
      expect(one(blueprint).source).toEqual({
        kind: 'needs-input',
        what: 'video-url',
      });
    });
  });

  describe('completion criteria', () => {
    it('fills type defaults and drops keys the type never reads', () => {
      const blueprint = normaliseBlueprint(
        rawPlan([
          rawItem('QUIZ', {
            completionCriteria: { minScore: 50, watchPct: 3 },
          }),
          rawItem('ANNOTATED_ARTIFACT'),
          rawItem('VIDEO', { spec: { url: 'https://vimeo.com/2' } }),
          rawItem('ARTICLE', { completionCriteria: { minReadSeconds: 45.4 } }),
          rawItem('JOURNAL', { completionCriteria: { passScore: 10 } }),
          rawItem('GAME', { completionCriteria: { minScore: 10 } }),
          rawItem('CASE', { completionCriteria: { minScore: 140 } }),
          rawItem('CASE'),
        ]),
        brief({ assessment: { kind: 'journal' } }),
      );
      expect(
        blueprint.sections[0].items.map((item) => item.completionCriteria),
      ).toEqual([
        { passScore: 70 },
        { passScore: 70 },
        { watchPct: 90 },
        { minReadSeconds: 45 },
        undefined,
        undefined,
        { minScore: 100 },
        undefined,
      ]);
    });

    it('resolves roleplay minScore: item, spec, practice slot, capstone threshold, then 60', () => {
      const blueprint = normaliseBlueprint(
        rawPlan([
          rawItem('ROLEPLAY', {
            completionCriteria: { minScore: 0, minDurationSeconds: 120 },
          }),
          rawItem('ROLEPLAY', { spec: { minScore: 55 } }),
          rawItem('ROLEPLAY', { spec: { slot: 2 } }),
          rawItem('ROLEPLAY', { source: { kind: 'library', scenarioId: 9 } }),
          rawItem('ROLEPLAY'),
          rawItem('JOURNAL'),
          rawItem('ROLEPLAY'),
        ]),
        brief({
          practice: [
            { slot: 2, source: 'new', minScore: 40 },
            { slot: 3, source: 'library', scenarioId: 9, minScore: 50 },
          ],
        }),
      );
      expect(
        blueprint.sections[0].items.map((item) => item.completionCriteria),
      ).toEqual([
        { minScore: 0, minDurationSeconds: 120 },
        { minScore: 55 },
        { minScore: 40 },
        { minScore: 50 },
        { minScore: 60 },
        undefined,
        { minScore: 75 },
      ]);
    });

    it('gives a capstone quiz the assessment threshold', () => {
      const blueprint = normaliseBlueprint(
        rawPlan([rawItem('QUIZ'), rawItem('QUIZ')]),
        brief({ assessment: { kind: 'quiz', threshold: 85 } }),
      );
      expect(
        blueprint.sections[0].items.map((item) => item.completionCriteria),
      ).toEqual([{ passScore: 70 }, { passScore: 85 }]);
    });
  });

  it('validates the game key', () => {
    const blueprint = normaliseBlueprint(
      rawPlan([
        rawItem('GAME', { spec: { gameKey: 'snake' } }),
        rawItem('GAME', { spec: { gameKey: 'PONG' } }),
      ]),
      brief(),
    );
    expect(
      blueprint.sections[0].items.map((item) => item.spec.gameKey),
    ).toEqual(['SNAKE', 'TREX_RUNNER']);
  });

  it('takes competencies and the cover from the brief', () => {
    const many = Array.from({ length: 20 }, (_, index) => `c-${index}`);
    const blueprint = normaliseBlueprint(
      rawPlan([rawItem('ARTICLE')], {
        cover: { mode: 'generate', prompt: 'A desk at dusk' },
      }),
      brief({
        competencyIds: many,
        look: {
          cover: 'library',
          coverImageUrl: 'https://cdn.example.com/c.png',
        },
      }),
    );
    expect(blueprint.competencyIds).toHaveLength(15);
    expect(blueprint.cover).toEqual({
      mode: 'library',
      prompt: 'A desk at dusk',
      imageUrl: 'https://cdn.example.com/c.png',
    });
    expect(blueprint.estimate.images).toBe(0);
  });

  it('survives garbage', () => {
    for (const raw of [
      null,
      'text',
      [],
      { sections: 'nope' },
      { sections: [null, 3, { items: 'x' }] },
    ]) {
      const blueprint = normaliseBlueprint(raw, brief());
      expect(blueprint.estimatedDurationMinutes).toBe(0);
      expect(
        blueprint.sections.every((section) => section.items.length === 0),
      ).toBe(true);
    }
  });
});

describe('validateBlueprint', () => {
  const plan = (
    items: Record<string, any>[],
    extra: Record<string, any> = {},
    b = brief(),
  ) => normaliseBlueprint(rawPlan(items, extra), b);

  it('passes a sound blueprint', () => {
    const blueprint = plan([
      rawItem('ARTICLE'),
      rawItem('ROLEPLAY', { spec: { languageIds: ['1', '2'] } }),
      rawItem('GAME'),
      rawItem('JOURNAL'),
      rawItem('VIDEO'),
    ]);
    expect(validateBlueprint(blueprint, brief(), OPTS)).toEqual([]);
  });

  it('flags an empty course', () => {
    expect(
      validateBlueprint(normaliseBlueprint({}, brief()), brief(), OPTS),
    ).toEqual(['The course has no sections yet.']);
  });

  it('flags section, item and per-section limits', () => {
    const sections = Array.from({ length: 9 }, (_, index) => ({
      title: `S${index}`,
      items: Array.from({ length: index === 0 ? 13 : 4 }, () =>
        rawItem('JOURNAL'),
      ),
    }));
    const blueprint = normaliseBlueprint({ sections }, brief());
    expect(validateBlueprint(blueprint, brief(), OPTS)).toEqual([
      'The course has 9 sections; a course can have at most 8. Merge or remove some.',
      'The course has 45 items; a course can have at most 40. Remove some.',
      "Section 1 · 'S0' has 13 items; a section can hold at most 12. Split it in two.",
    ]);
  });

  it('flags empty sections and missing titles', () => {
    const blueprint = normaliseBlueprint(
      {
        sections: [
          {
            title: '',
            items: [rawItem('QUIZ'), rawItem('QUIZ', { title: '  ' })],
          },
          { title: 'Practice', items: [] },
        ],
      },
      brief(),
    );
    expect(validateBlueprint(blueprint, brief(), OPTS)).toEqual([
      'Section 1 needs a title.',
      'Section 1 · item 2 (Quiz) needs a title.',
      "Section 2 · 'Practice' has no items. Add one or remove the section.",
    ]);
  });

  it('flags library items that do not say which roleplay or case', () => {
    const blueprint = plan([
      rawItem('ROLEPLAY', { title: 'Pick me', source: { kind: 'library' } }),
      rawItem('CASE', { title: 'Chain', source: { kind: 'library' } }),
    ]);
    expect(validateBlueprint(blueprint, brief(), OPTS)).toEqual([
      "Section 1 · 'Pick me' is set to use a library roleplay but doesn't say which one. Pick one, or make it a new roleplay.",
      "Section 1 · 'Chain' is set to use a library case but doesn't say which one. Pick one, or build a new case from this course's roleplays.",
    ]);
  });

  it("flags a new case with fewer than two of this course's roleplays", () => {
    const blueprint = plan([
      rawItem('ROLEPLAY', { id: 'r1' }),
      rawItem('QUIZ', { id: 'q1' }),
      rawItem('CASE', {
        title: 'Lonely',
        source: { kind: 'new' },
        spec: { memberItemIds: ['r1', 'q1'] },
      }),
      rawItem('CASE', { title: 'Empty', source: { kind: 'new' }, spec: {} }),
    ]);
    expect(validateBlueprint(blueprint, brief(), OPTS)).toEqual([
      "Section 1 · 'Lonely' is a new case but links only one roleplay; a case needs at least two roleplays from this course.",
      "Section 1 · 'Empty' is a new case but links no roleplays; a case needs at least two roleplays from this course.",
    ]);
  });

  it('flags a roleplay with too many languages and an unknown game', () => {
    const blueprint = plan([
      rawItem('ROLEPLAY', {
        title: 'Babel',
        spec: { languageIds: ['1', '2', '3', '4', '5', '5'] },
      }),
      rawItem('JOURNAL'),
    ]);
    blueprint.sections[0].items.push({
      ...one(blueprint, 1),
      id: 'g',
      type: 'GAME',
      title: 'Pong',
      spec: { gameKey: 'PONG' },
    });
    blueprint.sections[0].items.push({ ...one(blueprint, 1), id: 'j2' });
    expect(validateBlueprint(blueprint, brief(), OPTS)).toEqual([
      "Section 1 · 'Babel' is set to 5 languages; a roleplay can use at most 4.",
      "Section 1 · 'Pong' uses a game that isn't available.",
    ]);
  });

  it('flags a course that ends on a game', () => {
    const blueprint = plan([
      rawItem('ROLEPLAY'),
      rawItem('GAME', { title: 'Breather' }),
    ]);
    expect(validateBlueprint(blueprint, brief(), OPTS)).toEqual([
      "The course ends on a game ('Breather'). Games are breaks between harder items — move it earlier or remove it.",
    ]);
  });

  it('flags too many new roleplays, new cases and images', () => {
    const roleplays = Array.from({ length: 3 }, (_, index) =>
      rawItem('ROLEPLAY', { id: `r${index}` }),
    );
    const cases = Array.from({ length: 3 }, () =>
      rawItem('CASE', {
        source: { kind: 'new' },
        spec: { memberItemIds: ['r0', 'r1'] },
      }),
    );
    const articles = Array.from({ length: 12 }, () =>
      rawItem('ARTICLE', { spec: { withImage: true } }),
    );
    const blueprint = normaliseBlueprint(
      {
        sections: [
          { title: 'A', items: [...roleplays, ...cases] },
          { title: 'B', items: articles },
        ],
      },
      brief(),
    );
    expect(
      validateBlueprint(blueprint, brief(), { maxNewRoleplays: 2 }),
    ).toEqual([
      'The course would create 3 new roleplays; one course can create at most 2. Use library roleplays for some of them, or remove one.',
      'The course would create 3 new cases; one course can create at most 2.',
      'The course would generate 13 images; one course can have at most 12. Turn images off on some articles.',
    ]);
  });

  it('does not block on a video waiting for its link', () => {
    const blueprint = plan([
      rawItem('VIDEO', { title: 'Active listening demo' }),
      rawItem('QUIZ'),
    ]);
    expect(one(blueprint).source.kind).toBe('needs-input');
    expect(validateBlueprint(blueprint, brief(), OPTS)).toEqual([]);
  });
});

describe('blueprintWarnings', () => {
  it('names each video still waiting for a link', () => {
    const blueprint = normaliseBlueprint(
      {
        sections: [
          { title: 'One', items: [rawItem('QUIZ')] },
          {
            title: 'Two',
            items: [
              rawItem('VIDEO', { title: 'Active listening demo' }),
              rawItem('VIDEO', {
                title: '',
                spec: { url: 'https://vimeo.com/3' },
              }),
              rawItem('VIDEO', { title: '' }),
            ],
          },
        ],
      },
      brief(),
    );
    expect(blueprintWarnings(blueprint, brief())).toEqual([
      "Section 2 · 'Active listening demo' needs a video link — it will be skipped until you add one in the editor.",
      'Section 2 · item 3 (Video) needs a video link — it will be skipped until you add one in the editor.',
    ]);
  });

  it('mentions a supplied video that no item uses', () => {
    const b = brief({
      videoUrls: [
        { title: 'Used', url: 'https://vimeo.com/1', source: 'vimeo' },
        { title: 'Forgotten', url: 'https://vimeo.com/2', source: 'vimeo' },
      ],
    });
    const blueprint = normaliseBlueprint(
      rawPlan([rawItem('VIDEO', { spec: { url: 'https://vimeo.com/1' } })]),
      b,
    );
    expect(blueprintWarnings(blueprint, b)).toEqual([
      "The video 'Forgotten' isn't used anywhere in the course yet.",
    ]);
  });
});

describe('counting', () => {
  it('counts new roleplays and cases, not library ones', () => {
    const blueprint = normaliseBlueprint(
      rawPlan([
        rawItem('ROLEPLAY'),
        rawItem('ROLEPLAY', { source: { kind: 'library', scenarioId: 1 } }),
        rawItem('ROLEPLAY'),
        rawItem('CASE', { source: { kind: 'new' } }),
        rawItem('CASE', { source: { kind: 'library', caseId: 'x' } }),
      ]),
      brief(),
    );
    expect(countNewRoleplays(blueprint)).toBe(2);
    expect(countNewCases(blueprint)).toBe(1);
  });

  it('counts the generated cover and illustrated articles, item choice first', () => {
    const items = [
      rawItem('ARTICLE'),
      rawItem('ARTICLE', { spec: { withImage: false } }),
      rawItem('ARTICLE', { spec: { withImage: true } }),
      rawItem('QUIZ', { spec: { withImage: true } }),
    ];
    const perArticle = brief({
      look: { cover: 'generate', articleImages: 'one-per-article' },
    });
    expect(
      countImages(normaliseBlueprint(rawPlan(items), perArticle), perArticle),
    ).toBe(3);
    const none = brief({
      look: { cover: 'upload-later', articleImages: 'none' },
    });
    expect(countImages(normaliseBlueprint(rawPlan(items), none), none)).toBe(1);
    expect(articleWantsImage({ type: 'ARTICLE', spec: {} }, perArticle)).toBe(
      true,
    );
    expect(articleWantsImage({ type: 'ARTICLE', spec: {} }, none)).toBe(false);
  });
});

describe('game catalogue', () => {
  it('describes every game the track can run, once', () => {
    expect(COURSE_COPILOT_GAME_CATALOG.map((game) => game.key).sort()).toEqual(
      Object.values(TrackGameKey).sort(),
    );
    const options = courseCopilotGameOptions();
    expect(options).toHaveLength(Object.values(TrackGameKey).length);
    expect(options[0].description.startsWith('T-Rex Runner — ')).toBe(true);
  });
});
