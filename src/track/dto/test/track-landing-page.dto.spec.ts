import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import { TRACK_LANDING_LIMITS } from '../../type/track-landing-page.type';
import { CreateTrackDto } from '../create-track.dto';
import { UpdateTrackDto } from '../update-track.dto';

const SECTION = '00000000-0000-4000-8000-0000000000a1';

/** Every error message, down through the nested objects, as `path: constraint`. */
const flatten = (errors: ValidationError[], prefix = ''): string[] =>
  errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    return [
      ...Object.keys(error.constraints ?? {}).map(
        (constraint) => `${path}: ${constraint}`,
      ),
      ...flatten(error.children ?? [], path),
    ];
  });

const problems = async (
  Dto: typeof CreateTrackDto | typeof UpdateTrackDto,
  landingPage: unknown,
) => flatten(await validate(plainToInstance(Dto, { title: 'T', landingPage })));

describe.each([
  ['CreateTrackDto', CreateTrackDto],
  ['UpdateTrackDto', UpdateTrackDto],
])('%s landingPage', (_name, Dto) => {
  it('is optional: absent, null, {} and a one-key page all validate', async () => {
    expect(await validate(plainToInstance(Dto, { title: 'T' }))).toHaveLength(
      0,
    );
    expect(await problems(Dto, null)).toEqual([]);
    expect(await problems(Dto, {})).toEqual([]);
    expect(await problems(Dto, { hero: { hook: 'A call at 2am.' } })).toEqual(
      [],
    );
  });

  it('accepts a complete page', async () => {
    expect(
      await problems(Dto, {
        version: 1,
        hero: {
          hook: 'h',
          question: 'q',
          courseLine: 'c',
          buttonLabel: 'Take the case',
        },
        persona: {
          name: 'Meera, 19',
          descriptor: 'd',
          imageUrl: 'https://example.com/m.png',
          characterId: SECTION,
        },
        firstMove: {
          enabled: true,
          sceneLine: 's',
          personaLine: 'p',
          prompt: 'What do you say first?',
          replies: [{ text: 't', label: 'l', why: 'w' }],
        },
        arc: {
          enabled: false,
          chapters: [{ sectionId: SECTION, beat: 'CLIMAX', teaser: 't' }],
          hardCallSectionId: SECTION,
        },
        outcomes: { enabled: true, items: ['One', 'Two', 'Three'] },
        howItPlays: { enabled: true, sittingLength: 'MEDIUM' },
        cast: {
          enabled: true,
          callerLine: 'c',
          guide: { name: 'Dev', role: 'Supervisor', line: 'l' },
        },
        xp: { enabled: false },
        contentNotes: { extraNote: 'n' },
      }),
    ).toEqual([]);
  });

  it('lets null and "" clear a field, including an id', async () => {
    expect(
      await problems(Dto, {
        hero: { hook: null, question: '' },
        persona: { characterId: null, name: '' },
        arc: { hardCallSectionId: '' },
        howItPlays: { sittingLength: null },
        firstMove: { replies: [{ text: 'only text' }] },
      }),
    ).toEqual([]);
  });

  it('reaches into nested objects: a wrong type deep inside is a 400', async () => {
    expect(await problems(Dto, { hero: { hook: 7 } })).toContain(
      'landingPage.hero.hook: isString',
    );
    expect(await problems(Dto, { hero: 'a string' })).not.toEqual([]);
    expect(
      await problems(Dto, { firstMove: { replies: [{ text: 5 }] } }),
    ).toContain('landingPage.firstMove.replies.0.text: isString');
    expect(await problems(Dto, { firstMove: { enabled: 'yes' } })).toContain(
      'landingPage.firstMove.enabled: isBoolean',
    );
  });

  it('rejects an unknown beat or sitting length, and a non-uuid id', async () => {
    expect(
      await problems(Dto, {
        arc: { chapters: [{ sectionId: SECTION, beat: 'FINALE' }] },
      }),
    ).toContain('landingPage.arc.chapters.0.beat: isEnum');
    expect(
      await problems(Dto, { howItPlays: { sittingLength: 'FOREVER' } }),
    ).toContain('landingPage.howItPlays.sittingLength: isEnum');
    expect(
      await problems(Dto, { arc: { hardCallSectionId: 'not-a-uuid' } }),
    ).toContain('landingPage.arc.hardCallSectionId: isUuid');
    expect(
      await problems(Dto, {
        arc: { chapters: [{ sectionId: 'not-a-uuid' }] },
      }),
    ).toContain('landingPage.arc.chapters.0.sectionId: isUuid');
    expect(
      await problems(Dto, { persona: { characterId: 'not-a-uuid' } }),
    ).toContain('landingPage.persona.characterId: isUuid');
  });

  describe('limits', () => {
    const over = (max: number) => 'x'.repeat(max + 1);
    const at = (max: number) => 'x'.repeat(max);

    it.each([
      ['hero.hook', 'hook', (v: string) => ({ hero: { hook: v } })],
      ['hero.question', 'question', (v: string) => ({ hero: { question: v } })],
      [
        'hero.courseLine',
        'courseLine',
        (v: string) => ({ hero: { courseLine: v } }),
      ],
      [
        'hero.buttonLabel',
        'buttonLabel',
        (v: string) => ({ hero: { buttonLabel: v } }),
      ],
      [
        'persona.name',
        'personaName',
        (v: string) => ({ persona: { name: v } }),
      ],
      [
        'persona.descriptor',
        'personaDescriptor',
        (v: string) => ({ persona: { descriptor: v } }),
      ],
      [
        'persona.imageUrl',
        'personaImageUrl',
        (v: string) => ({ persona: { imageUrl: v } }),
      ],
      [
        'firstMove.sceneLine',
        'sceneLine',
        (v: string) => ({ firstMove: { sceneLine: v } }),
      ],
      [
        'firstMove.personaLine',
        'personaLine',
        (v: string) => ({ firstMove: { personaLine: v } }),
      ],
      [
        'firstMove.prompt',
        'prompt',
        (v: string) => ({ firstMove: { prompt: v } }),
      ],
      [
        'firstMove.replies[].text',
        'replyText',
        (v: string) => ({ firstMove: { replies: [{ text: v }] } }),
      ],
      [
        'firstMove.replies[].label',
        'replyLabel',
        (v: string) => ({ firstMove: { replies: [{ label: v }] } }),
      ],
      [
        'firstMove.replies[].why',
        'replyWhy',
        (v: string) => ({ firstMove: { replies: [{ why: v }] } }),
      ],
      [
        'arc.chapters[].teaser',
        'teaser',
        (v: string) => ({
          arc: { chapters: [{ sectionId: SECTION, teaser: v }] },
        }),
      ],
      [
        'outcomes.items[]',
        'outcome',
        (v: string) => ({ outcomes: { items: [v] } }),
      ],
      [
        'cast.callerLine',
        'callerLine',
        (v: string) => ({ cast: { callerLine: v } }),
      ],
      [
        'cast.guide.name',
        'guideName',
        (v: string) => ({ cast: { guide: { name: v } } }),
      ],
      [
        'cast.guide.role',
        'guideRole',
        (v: string) => ({ cast: { guide: { role: v } } }),
      ],
      [
        'cast.guide.line',
        'guideLine',
        (v: string) => ({ cast: { guide: { line: v } } }),
      ],
      [
        'contentNotes.extraNote',
        'extraNote',
        (v: string) => ({ contentNotes: { extraNote: v } }),
      ],
    ] as const)(
      '%s: accepts the limit, rejects one past it',
      async (_path, limit, build) => {
        const max = TRACK_LANDING_LIMITS[limit];
        expect(await problems(Dto, build(at(max)))).toEqual([]);
        const rejected = await problems(Dto, build(over(max)));
        expect(rejected).toHaveLength(1);
        expect(rejected[0]).toMatch(/maxLength$/);
      },
    );

    it('caps replies at 4, chapters at 100 and outcomes at 3', async () => {
      const replies = (n: number) =>
        Array.from({ length: n }, () => ({ text: 't', label: 'l' }));
      expect(
        await problems(Dto, { firstMove: { replies: replies(4) } }),
      ).toEqual([]);
      expect(
        await problems(Dto, { firstMove: { replies: replies(5) } }),
      ).toContain('landingPage.firstMove.replies: arrayMaxSize');

      const chapters = (n: number) =>
        Array.from({ length: n }, () => ({ sectionId: SECTION }));
      expect(await problems(Dto, { arc: { chapters: chapters(100) } })).toEqual(
        [],
      );
      expect(
        await problems(Dto, { arc: { chapters: chapters(101) } }),
      ).toContain('landingPage.arc.chapters: arrayMaxSize');

      expect(
        await problems(Dto, { outcomes: { items: ['a', 'b', 'c'] } }),
      ).toEqual([]);
      expect(
        await problems(Dto, { outcomes: { items: ['a', 'b', 'c', 'd'] } }),
      ).toContain('landingPage.outcomes.items: arrayMaxSize');
    });
  });
});
