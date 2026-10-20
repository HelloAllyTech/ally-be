import { TRACK_ITEM_XP, XP_AWARD } from 'src/progress/progress.constants';
import { TrackItemType } from '../../type/track.type';
import {
  LandingSittingLength,
  StoryBeat,
  TrackLandingPage,
} from '../../type/track-landing-page.type';
import {
  buildPublicTrackStory,
  localiseTriggerWarningName,
  normaliseTrackLandingPage,
  PublicStorySection,
  remapLandingPageSections,
} from '../track-landing-page.util';

/** A page with a hook and nothing else — story mode on, every block empty. */
const pageWith = (
  patch: {
    [K in Exclude<keyof TrackLandingPage, 'version'>]?: Partial<
      TrackLandingPage[K]
    >;
  } = {},
): TrackLandingPage => {
  const base = normaliseTrackLandingPage({
    hero: { hook: 'A call comes in at 2am.' },
  });
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = {
      ...(base as unknown as Record<string, object>)[key],
      ...value,
    };
  }
  return merged as unknown as TrackLandingPage;
};

const reply = (text: string, label: string, why: string | null = null) => ({
  text,
  label,
  why,
});

const sections: PublicStorySection[] = [
  {
    id: 's1',
    items: [{ type: TrackItemType.ARTICLE }, { type: TrackItemType.QUIZ }],
  },
  {
    id: 's2',
    items: [{ type: TrackItemType.ROLEPLAY }, { type: TrackItemType.JOURNAL }],
  },
  { id: 's3', items: [{ type: TrackItemType.ROLEPLAY }] },
];

describe('normaliseTrackLandingPage', () => {
  it('turns null, undefined and junk into the full default shape', () => {
    const empty = normaliseTrackLandingPage(null);
    expect(normaliseTrackLandingPage(undefined)).toEqual(empty);
    expect(normaliseTrackLandingPage('nope')).toEqual(empty);
    expect(normaliseTrackLandingPage([])).toEqual(empty);
    expect(empty).toEqual({
      version: 1,
      hero: {
        hook: null,
        question: null,
        courseLine: null,
        buttonLabel: null,
      },
      persona: {
        name: null,
        descriptor: null,
        imageUrl: null,
        characterId: null,
      },
      firstMove: {
        enabled: true,
        sceneLine: null,
        personaLine: null,
        prompt: null,
        replies: [],
      },
      arc: { enabled: true, chapters: [], hardCallSectionId: null },
      outcomes: { enabled: true, items: [] },
      howItPlays: { enabled: true, sittingLength: null },
      cast: {
        enabled: true,
        callerLine: null,
        guide: { name: null, role: null, line: null },
      },
      xp: { enabled: true },
      contentNotes: { extraNote: null },
    });
  });

  it('trims strings and turns blanks into null', () => {
    const page = normaliseTrackLandingPage({
      hero: { hook: '  Meera calls.  ', question: '   ', courseLine: '' },
      persona: { name: ' Meera, 19 ', descriptor: '\n' },
      contentNotes: { extraNote: '  Take a break if you need one.  ' },
    });
    expect(page.hero).toEqual({
      hook: 'Meera calls.',
      question: null,
      courseLine: null,
      buttonLabel: null,
    });
    expect(page.persona.name).toBe('Meera, 19');
    expect(page.persona.descriptor).toBeNull();
    expect(page.contentNotes.extraNote).toBe('Take a break if you need one.');
  });

  it('switches a block off only on an explicit false', () => {
    const page = normaliseTrackLandingPage({
      firstMove: { enabled: false },
      arc: { enabled: 0 },
      outcomes: { enabled: 'false' },
      xp: { enabled: false },
    });
    expect(page.firstMove.enabled).toBe(false);
    expect(page.xp.enabled).toBe(false);
    expect(page.arc.enabled).toBe(true);
    expect(page.outcomes.enabled).toBe(true);
    expect(page.howItPlays.enabled).toBe(true);
    expect(page.cast.enabled).toBe(true);
  });

  it('drops replies with no text, keeps a reply with no label, and caps at four', () => {
    const page = normaliseTrackLandingPage({
      firstMove: {
        replies: [
          { text: '  ', label: 'Nothing' },
          { text: 'Take your time.', label: ' You gave her room ', why: ' ' },
          { text: 'What happened?' },
          { text: 'c' },
          { text: 'd' },
          { text: 'e' },
          null,
        ],
      },
    });
    expect(page.firstMove.replies).toEqual([
      { text: 'Take your time.', label: 'You gave her room', why: null },
      { text: 'What happened?', label: '', why: null },
      { text: 'c', label: '', why: null },
      { text: 'd', label: '', why: null },
    ]);
  });

  it('keeps at most three non-empty outcomes', () => {
    const page = normaliseTrackLandingPage({
      outcomes: {
        items: [
          ' Open a call ',
          '',
          '  ',
          'Ask directly',
          7,
          'Close well',
          'x',
        ],
      },
    });
    expect(page.outcomes.items).toEqual([
      'Open a call',
      'Ask directly',
      'Close well',
    ]);
  });

  it('de-dupes chapters by section id, the last one winning', () => {
    const page = normaliseTrackLandingPage({
      arc: {
        chapters: [
          { sectionId: 'a', beat: 'SETUP', teaser: 'first' },
          { sectionId: 'b', beat: 'CLIMAX', teaser: 'b' },
          { sectionId: 'a', beat: 'CONFLICT', teaser: ' second ' },
          { sectionId: '  ', beat: 'SETUP' },
          { beat: 'SETUP' },
        ],
      },
    });
    expect(page.arc.chapters).toEqual([
      { sectionId: 'b', beat: StoryBeat.CLIMAX, teaser: 'b' },
      { sectionId: 'a', beat: StoryBeat.CONFLICT, teaser: 'second' },
    ]);
  });

  it('caps chapters at 100', () => {
    const chapters = Array.from({ length: 130 }, (_, index) => ({
      sectionId: `s${index}`,
    }));
    expect(
      normaliseTrackLandingPage({ arc: { chapters } }).arc.chapters,
    ).toHaveLength(100);
  });

  it('nulls a beat or sitting length it does not know', () => {
    const page = normaliseTrackLandingPage({
      arc: { chapters: [{ sectionId: 'a', beat: 'FINALE' }] },
      howItPlays: { sittingLength: 'FOREVER' },
    });
    expect(page.arc.chapters[0].beat).toBeNull();
    expect(page.howItPlays.sittingLength).toBeNull();
    expect(
      normaliseTrackLandingPage({ howItPlays: { sittingLength: 'LONG' } })
        .howItPlays.sittingLength,
    ).toBe(LandingSittingLength.LONG);
  });

  it('is idempotent on its own output', () => {
    const once = normaliseTrackLandingPage({
      hero: { hook: 'Hook' },
      firstMove: { replies: [reply('a', 'b', 'c')] },
      arc: { chapters: [{ sectionId: 'x', beat: 'SETUP', teaser: 't' }] },
      outcomes: { items: ['One'] },
      cast: { guide: { name: 'Dev' } },
    });
    expect(normaliseTrackLandingPage(once)).toEqual(once);
  });
});

describe('remapLandingPageSections', () => {
  const page = normaliseTrackLandingPage({
    hero: { hook: 'Hook' },
    arc: {
      chapters: [
        { sectionId: 'old-1', beat: 'SETUP', teaser: 'one' },
        { sectionId: 'old-2', beat: 'CLIMAX', teaser: 'two' },
        { sectionId: 'old-gone', beat: 'CONFLICT', teaser: 'gone' },
      ],
      hardCallSectionId: 'old-2',
    },
  });

  it('re-points chapters and the hard call at the copy', () => {
    const remapped = remapLandingPageSections(
      page,
      new Map([
        ['old-1', 'new-1'],
        ['old-2', 'new-2'],
      ]),
    );
    expect(remapped?.arc.chapters).toEqual([
      { sectionId: 'new-1', beat: StoryBeat.SETUP, teaser: 'one' },
      { sectionId: 'new-2', beat: StoryBeat.CLIMAX, teaser: 'two' },
    ]);
    expect(remapped?.arc.hardCallSectionId).toBe('new-2');
    expect(remapped?.hero.hook).toBe('Hook');
  });

  it('nulls a hard call whose section has no mapping', () => {
    const remapped = remapLandingPageSections(
      page,
      new Map([['old-1', 'new-1']]),
    );
    expect(remapped?.arc.hardCallSectionId).toBeNull();
    expect(remapped?.arc.chapters.map((chapter) => chapter.sectionId)).toEqual([
      'new-1',
    ]);
  });

  it('does not touch the original page', () => {
    const before = JSON.stringify(page);
    remapLandingPageSections(page, new Map([['old-1', 'new-1']]));
    expect(JSON.stringify(page)).toBe(before);
  });

  it('returns null for no page', () => {
    expect(remapLandingPageSections(null, new Map())).toBeNull();
    expect(remapLandingPageSections(undefined, new Map())).toBeNull();
  });
});

describe('buildPublicTrackStory', () => {
  describe('story mode', () => {
    it('is off without a landing page', () => {
      expect(buildPublicTrackStory(null, sections)).toBeNull();
      expect(buildPublicTrackStory(undefined, sections)).toBeNull();
    });

    it('is off without a hook, however complete the rest is', () => {
      const page = normaliseTrackLandingPage({
        hero: { question: 'Will you know what to say?' },
        persona: { name: 'Meera, 19' },
        outcomes: { items: ['One'] },
      });
      expect(buildPublicTrackStory(page, sections)).toBeNull();
    });

    it('is on with only a hook, and every other block is empty', () => {
      const story = buildPublicTrackStory(pageWith(), sections);
      expect(story).toEqual({
        hook: 'A call comes in at 2am.',
        question: null,
        courseLine: null,
        buttonLabel: null,
        persona: null,
        firstMove: null,
        arc: {
          chapters: [
            { sectionId: 's1', beat: null, teaser: null },
            { sectionId: 's2', beat: null, teaser: null },
            { sectionId: 's3', beat: null, teaser: null },
          ],
          hardCallSectionId: null,
        },
        outcomes: null,
        howItPlays: { sittingLength: null },
        cast: null,
        xp: { activityXp: expect.any(Number), hasRoleplays: true },
        contentNotes: null,
      });
    });

    it('passes the hero fields through', () => {
      const story = buildPublicTrackStory(
        normaliseTrackLandingPage({
          hero: {
            hook: 'Hook',
            question: 'Will you know what to say?',
            courseLine: 'Ten minutes at a time',
            buttonLabel: 'Take the case',
          },
        }),
        sections,
      );
      expect(story).toMatchObject({
        hook: 'Hook',
        question: 'Will you know what to say?',
        courseLine: 'Ten minutes at a time',
        buttonLabel: 'Take the case',
      });
    });
  });

  describe('persona', () => {
    it('shows when the persona has a name', () => {
      const story = buildPublicTrackStory(
        pageWith({
          persona: {
            name: 'Meera, 19',
            descriptor: 'A first-year student.',
            imageUrl: 'https://example.com/m.png',
            characterId: 'char-1',
          },
        }),
        sections,
      );
      expect(story?.persona).toEqual({
        name: 'Meera, 19',
        descriptor: 'A first-year student.',
        imageUrl: 'https://example.com/m.png',
      });
      // The character id is for traceability; it never reaches the public.
      expect(JSON.stringify(story)).not.toContain('char-1');
    });

    it('is hidden without a name, even with a descriptor and image', () => {
      const story = buildPublicTrackStory(
        pageWith({
          persona: { descriptor: 'A student.', imageUrl: 'https://x/y.png' },
        }),
        sections,
      );
      expect(story?.persona).toBeNull();
    });
  });

  describe('first move', () => {
    const complete = {
      enabled: true,
      sceneLine: 'Her fourth message in ten minutes.',
      personaLine: 'I don’t know why I’m texting.',
      prompt: 'What do you say first?',
      replies: [
        reply('Take your time.', 'You gave her room', 'She keeps the pace.'),
        reply('Tell me what happened.', 'You started with intake'),
      ],
    };

    it('shows with a persona line and two replies carrying text and label', () => {
      const story = buildPublicTrackStory(
        pageWith({ firstMove: complete }),
        sections,
      );
      expect(story?.firstMove).toEqual({
        sceneLine: 'Her fourth message in ten minutes.',
        personaLine: 'I don’t know why I’m texting.',
        prompt: 'What do you say first?',
        replies: [
          {
            text: 'Take your time.',
            label: 'You gave her room',
            why: 'She keeps the pace.',
          },
          {
            text: 'Tell me what happened.',
            label: 'You started with intake',
            why: null,
          },
        ],
      });
    });

    it('is hidden when switched off', () => {
      const story = buildPublicTrackStory(
        pageWith({ firstMove: { ...complete, enabled: false } }),
        sections,
      );
      expect(story?.firstMove).toBeNull();
    });

    it('is hidden without a persona line', () => {
      const story = buildPublicTrackStory(
        pageWith({ firstMove: { ...complete, personaLine: null } }),
        sections,
      );
      expect(story?.firstMove).toBeNull();
    });

    it('needs text AND label on a reply: one reply missing a label leaves only one, so it hides', () => {
      const story = buildPublicTrackStory(
        pageWith({
          firstMove: {
            ...complete,
            replies: [
              reply('Take your time.', 'You gave her room'),
              reply('x', ''),
            ],
          },
        }),
        sections,
      );
      expect(story?.firstMove).toBeNull();
    });

    it('drops an unlabelled reply but still shows when two good ones remain', () => {
      const story = buildPublicTrackStory(
        pageWith({
          firstMove: {
            ...complete,
            replies: [
              ...complete.replies,
              reply('Unlabelled reply', ''),
              reply('Third', 'You named it'),
            ],
          },
        }),
        sections,
      );
      expect(story?.firstMove?.replies.map((r) => r.label)).toEqual([
        'You gave her room',
        'You started with intake',
        'You named it',
      ]);
    });

    it('is hidden with fewer than two replies', () => {
      const story = buildPublicTrackStory(
        pageWith({
          firstMove: { ...complete, replies: [complete.replies[0]] },
        }),
        sections,
      );
      expect(story?.firstMove).toBeNull();
    });
  });

  describe('story arc', () => {
    it('lists one chapter per live section, in section order, ignoring config order', () => {
      const story = buildPublicTrackStory(
        pageWith({
          arc: {
            chapters: [
              {
                sectionId: 's3',
                beat: StoryBeat.CLIMAX,
                teaser: 'The hard one',
              },
              { sectionId: 's1', beat: StoryBeat.SETUP, teaser: null },
            ],
          },
        }),
        sections,
      );
      expect(story?.arc?.chapters).toEqual([
        { sectionId: 's1', beat: StoryBeat.SETUP, teaser: null },
        { sectionId: 's2', beat: null, teaser: null },
        { sectionId: 's3', beat: StoryBeat.CLIMAX, teaser: 'The hard one' },
      ]);
    });

    it('ignores config for sections that no longer exist', () => {
      const story = buildPublicTrackStory(
        pageWith({
          arc: {
            chapters: [
              { sectionId: 'deleted', beat: StoryBeat.CONFLICT, teaser: 'x' },
            ],
          },
        }),
        sections,
      );
      expect(story?.arc?.chapters.map((chapter) => chapter.sectionId)).toEqual([
        's1',
        's2',
        's3',
      ]);
      expect(JSON.stringify(story)).not.toContain('deleted');
    });

    it('keeps the hard call only when it is one of the sections', () => {
      const live = buildPublicTrackStory(
        pageWith({ arc: { hardCallSectionId: 's3' } }),
        sections,
      );
      expect(live?.arc?.hardCallSectionId).toBe('s3');

      const stale = buildPublicTrackStory(
        pageWith({ arc: { hardCallSectionId: 'deleted' } }),
        sections,
      );
      expect(stale?.arc?.hardCallSectionId).toBeNull();
    });

    it('is hidden when switched off', () => {
      expect(
        buildPublicTrackStory(pageWith({ arc: { enabled: false } }), sections)
          ?.arc,
      ).toBeNull();
    });

    it('is hidden for a course with no sections', () => {
      expect(buildPublicTrackStory(pageWith(), [])?.arc).toBeNull();
    });
  });

  describe('outcomes', () => {
    it('shows with at least one item', () => {
      const story = buildPublicTrackStory(
        pageWith({ outcomes: { items: ['Open a call', 'Ask directly'] } }),
        sections,
      );
      expect(story?.outcomes).toEqual(['Open a call', 'Ask directly']);
    });

    it('is hidden with none, or when switched off', () => {
      expect(buildPublicTrackStory(pageWith(), sections)?.outcomes).toBeNull();
      expect(
        buildPublicTrackStory(
          pageWith({ outcomes: { enabled: false, items: ['One'] } }),
          sections,
        )?.outcomes,
      ).toBeNull();
    });
  });

  describe('how it plays', () => {
    it('shows by default, carrying the sitting length', () => {
      const story = buildPublicTrackStory(
        pageWith({ howItPlays: { sittingLength: LandingSittingLength.SHORT } }),
        sections,
      );
      expect(story?.howItPlays).toEqual({
        sittingLength: LandingSittingLength.SHORT,
      });
    });

    it('is hidden when switched off', () => {
      expect(
        buildPublicTrackStory(
          pageWith({ howItPlays: { enabled: false } }),
          sections,
        )?.howItPlays,
      ).toBeNull();
    });
  });

  describe('cast', () => {
    it('needs a persona name or a guide name', () => {
      expect(
        buildPublicTrackStory(
          pageWith({ cast: { callerLine: 'A line with nobody to say it.' } }),
          sections,
        )?.cast,
      ).toBeNull();
    });

    it('shows the caller from the persona and the caller line', () => {
      const story = buildPublicTrackStory(
        pageWith({
          persona: { name: 'Meera, 19', imageUrl: 'https://x/m.png' },
          cast: { callerLine: 'Short on words, long on silence.' },
        }),
        sections,
      );
      expect(story?.cast).toEqual({
        caller: {
          name: 'Meera, 19',
          line: 'Short on words, long on silence.',
          imageUrl: 'https://x/m.png',
        },
        guide: null,
      });
    });

    it('shows a guide alone, without a caller', () => {
      const story = buildPublicTrackStory(
        pageWith({
          cast: {
            guide: { name: 'Dev', role: 'Shift supervisor', line: 'Ask me.' },
          },
        }),
        sections,
      );
      expect(story?.cast).toEqual({
        caller: null,
        guide: { name: 'Dev', role: 'Shift supervisor', line: 'Ask me.' },
      });
    });

    it('is hidden when switched off', () => {
      expect(
        buildPublicTrackStory(
          pageWith({
            persona: { name: 'Meera' },
            cast: { enabled: false },
          }),
          sections,
        )?.cast,
      ).toBeNull();
    });
  });

  describe('xp line', () => {
    it('sums item XP and adds the completion award for each roleplay', () => {
      const story = buildPublicTrackStory(pageWith(), sections);
      const expected =
        TRACK_ITEM_XP[TrackItemType.ARTICLE] +
        TRACK_ITEM_XP[TrackItemType.QUIZ] +
        TRACK_ITEM_XP[TrackItemType.JOURNAL] +
        2 *
          (TRACK_ITEM_XP[TrackItemType.ROLEPLAY] +
            XP_AWARD.PER_SESSION_COMPLETED);
      expect(story?.xp).toEqual({ activityXp: expected, hasRoleplays: true });
    });

    it('is the component XP alone, with no roleplays', () => {
      const story = buildPublicTrackStory(pageWith(), [
        {
          id: 'a',
          items: [
            { type: TrackItemType.QUIZ },
            { type: TrackItemType.VIDEO },
            { type: TrackItemType.GAME },
            { type: TrackItemType.CASE },
            { type: TrackItemType.ANNOTATED_ARTIFACT },
          ],
        },
      ]);
      expect(story?.xp).toEqual({
        activityXp:
          TRACK_ITEM_XP[TrackItemType.QUIZ] +
          TRACK_ITEM_XP[TrackItemType.VIDEO] +
          TRACK_ITEM_XP[TrackItemType.GAME] +
          TRACK_ITEM_XP[TrackItemType.CASE] +
          TRACK_ITEM_XP[TrackItemType.ANNOTATED_ARTIFACT],
        hasRoleplays: false,
      });
    });

    it('is zero for an empty course, and hidden when switched off', () => {
      expect(buildPublicTrackStory(pageWith(), [])?.xp).toEqual({
        activityXp: 0,
        hasRoleplays: false,
      });
      expect(
        buildPublicTrackStory(pageWith({ xp: { enabled: false } }), sections)
          ?.xp,
      ).toBeNull();
    });
  });

  describe('content notes', () => {
    it('is absent with no warnings and no extra note', () => {
      expect(
        buildPublicTrackStory(pageWith(), sections, new Map())?.contentNotes,
      ).toBeNull();
    });

    it('groups a warning across sections into distinct names with ascending 1-based chapters', () => {
      const story = buildPublicTrackStory(
        pageWith(),
        sections,
        new Map([
          ['s3', ['Self-harm', 'Suicide']],
          ['s2', ['Suicide', 'Suicide', ' Suicide ']],
        ]),
      );
      expect(story?.contentNotes).toEqual({
        warnings: [
          { name: 'Suicide', chapters: [2, 3] },
          { name: 'Self-harm', chapters: [3] },
        ],
        extraNote: null,
      });
    });

    it('lists names in the order a learner first meets them, alphabetically within a chapter', () => {
      const story = buildPublicTrackStory(
        pageWith(),
        sections,
        new Map([
          ['s1', ['Violence', 'Abuse']],
          ['s3', ['Grief']],
        ]),
      );
      expect(story?.contentNotes?.warnings.map((w) => w.name)).toEqual([
        'Abuse',
        'Violence',
        'Grief',
      ]);
    });

    it('ignores warnings on sections that are not in the outline, and blank names', () => {
      const story = buildPublicTrackStory(
        pageWith(),
        sections,
        new Map([
          ['elsewhere', ['Abuse']],
          ['s1', ['  ', '']],
        ]),
      );
      expect(story?.contentNotes).toBeNull();
    });

    it('appears for an extra note alone, with no warnings', () => {
      const story = buildPublicTrackStory(
        pageWith({ contentNotes: { extraNote: 'Some calls run long.' } }),
        sections,
      );
      expect(story?.contentNotes).toEqual({
        warnings: [],
        extraNote: 'Some calls run long.',
      });
    });

    it('cannot be switched off while a warning exists: it has no switch', () => {
      const page = pageWith();
      expect(Object.keys(page.contentNotes)).toEqual(['extraNote']);
      expect(
        buildPublicTrackStory(page, sections, new Map([['s2', ['Grief']]]))
          ?.contentNotes?.warnings,
      ).toEqual([{ name: 'Grief', chapters: [2] }]);
    });
  });
});

describe('localiseTriggerWarningName', () => {
  const translations = {
    hi: { name: 'आत्म-हानि' },
    ta: { name: '   ' },
  };

  it('uses the translation for the resolved language', () => {
    expect(localiseTriggerWarningName('Self-harm', translations, 'hi')).toBe(
      'आत्म-हानि',
    );
  });

  it('resolves a regional tag against its base language', () => {
    expect(localiseTriggerWarningName('Self-harm', translations, 'hi-IN')).toBe(
      'आत्म-हानि',
    );
  });

  it('falls back to the English name when there is nothing usable', () => {
    expect(localiseTriggerWarningName('Self-harm', translations, 'ta')).toBe(
      'Self-harm',
    );
    expect(localiseTriggerWarningName('Self-harm', translations, 'kn')).toBe(
      'Self-harm',
    );
    expect(localiseTriggerWarningName('Self-harm', null, 'hi')).toBe(
      'Self-harm',
    );
    expect(localiseTriggerWarningName('Self-harm', 'junk', 'hi')).toBe(
      'Self-harm',
    );
  });

  it('serves English as it is', () => {
    expect(localiseTriggerWarningName('Self-harm', translations, 'en')).toBe(
      'Self-harm',
    );
    expect(localiseTriggerWarningName('Self-harm', translations, null)).toBe(
      'Self-harm',
    );
  });
});
