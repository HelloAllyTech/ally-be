import { StoryBeat } from 'src/track/type/track-landing-page.type';
import { normaliseTrackLandingPage } from 'src/track/util/track-landing-page.util';
import {
  landingPageOutlineForPrompt,
  LandingPageSpecialist,
  normaliseLandingPageDraft,
  triggerWarningsForPrompt,
} from '../landing-page.specialist';
import {
  LandingPageInput,
  SpecialistValidationError,
} from '../specialist.types';
import { fakeLlm } from './specialist-test.fixtures';

const S1 = '00000000-0000-4000-8000-0000000000a1';
const S2 = '00000000-0000-4000-8000-0000000000a2';
const S3 = '00000000-0000-4000-8000-0000000000a3';
const SECTION_IDS = [S1, S2, S3];

const TEMPLATE =
  'PROMPT\ntitle={{course_title}}\ndescription={{course_description}}\n' +
  'minutes={{course_duration_minutes}}\noutline={{course_outline}}\n' +
  'warnings={{trigger_warnings}}\ncurrent={{current_landing_page}}';

/** A clean model answer for the three sections above. */
const answer = (overrides: Record<string, any> = {}) => ({
  hero: {
    hook: 'Meera, 19, texts the line every Tuesday. Tonight she deletes her first message twice.',
    question: 'Will you know what to say?',
    courseLine: 'Practise staying with a texter who goes quiet.',
    buttonLabel: 'Take the case',
  },
  persona: {
    name: 'Meera, 19',
    descriptor: 'A first-year student on her own.',
  },
  firstMove: {
    sceneLine: 'Her fourth message in ten minutes.',
    personaLine: 'I do not know why I am texting.',
    prompt: 'What do you say first?',
    replies: [
      {
        text: 'Take your time.',
        label: 'You gave her room',
        why: 'It lowers the pressure to explain.',
      },
      {
        text: 'Tell me what happened.',
        label: 'You started with intake',
        why: 'It moves straight to the facts.',
      },
      {
        text: 'That sounds hard.',
        label: 'You named the feeling',
        why: 'It shows you heard her.',
      },
    ],
  },
  arc: {
    chapters: [
      { sectionId: S1, beat: 'SETUP', teaser: 'The first shift is quiet.' },
      { sectionId: S2, beat: 'CONFLICT', teaser: 'She stops answering.' },
      {
        sectionId: S3,
        beat: 'CLIMAX',
        teaser: 'One message changes the tone.',
      },
    ],
    hardCallSectionId: S3,
  },
  outcomes: {
    items: [
      'Open a call so the caller keeps talking',
      'Reflect the feeling before the facts',
      'Ask one open question at a time',
    ],
  },
  howItPlays: { sittingLength: 'MEDIUM' },
  cast: {
    callerLine: 'Short on words, long on silence.',
    guide: { name: 'Dev', role: 'Shift supervisor', line: 'Ask me anything.' },
  },
  contentNotes: { extraNote: null },
  ...overrides,
});

describe('normaliseLandingPageDraft', () => {
  it('returns the full shape with every block on and no image or character id', () => {
    const page = normaliseLandingPageDraft(answer(), SECTION_IDS);

    expect(page.version).toBe(1);
    expect(page.hero.hook).toContain('Meera, 19');
    expect(page.persona).toEqual({
      name: 'Meera, 19',
      descriptor: 'A first-year student on her own.',
      imageUrl: null,
      characterId: null,
    });
    expect(page.firstMove.enabled).toBe(true);
    expect(page.firstMove.replies).toHaveLength(3);
    expect(page.arc.enabled).toBe(true);
    expect(page.outcomes.enabled).toBe(true);
    expect(page.outcomes.items).toHaveLength(3);
    expect(page.howItPlays).toEqual({ enabled: true, sittingLength: 'MEDIUM' });
    expect(page.cast.enabled).toBe(true);
    expect(page.xp.enabled).toBe(true);
    expect(page.contentNotes.extraNote).toBeNull();
    expect(page).toEqual(normaliseTrackLandingPage(page));
  });

  it('forces every block on even when the model switches one off', () => {
    const page = normaliseLandingPageDraft(
      answer({
        firstMove: { ...answer().firstMove, enabled: false },
        arc: { ...answer().arc, enabled: false },
        xp: { enabled: false },
      }),
      SECTION_IDS,
    );
    expect(page.firstMove.enabled).toBe(true);
    expect(page.arc.enabled).toBe(true);
    expect(page.xp.enabled).toBe(true);
  });

  it('never carries an image or character id the model invented', () => {
    const page = normaliseLandingPageDraft(
      answer({
        persona: {
          name: 'Meera, 19',
          imageUrl: 'https://evil.example/x.png',
          characterId: '00000000-0000-4000-8000-0000000000ff',
        },
      }),
      SECTION_IDS,
    );
    expect(page.persona.imageUrl).toBeNull();
    expect(page.persona.characterId).toBeNull();
  });

  describe('truncation at word boundaries', () => {
    const long = (words: number) =>
      Array.from({ length: words }, () => 'listening').join(' ');

    it('cuts every field to its limit without breaking a word', () => {
      const page = normaliseLandingPageDraft(
        answer({
          hero: {
            hook: long(40),
            question: long(40),
            courseLine: long(40),
            buttonLabel: long(40),
          },
          persona: { name: long(20), descriptor: long(40) },
          firstMove: {
            sceneLine: long(20),
            personaLine: long(60),
            prompt: long(40),
            replies: [
              { text: long(60), label: long(20), why: long(60) },
              { text: 'b', label: 'b', why: 'b' },
            ],
          },
          arc: {
            chapters: [{ sectionId: S1, beat: 'SETUP', teaser: long(40) }],
            hardCallSectionId: S1,
          },
          outcomes: { items: [long(40), long(40), long(40), long(40)] },
          cast: {
            callerLine: long(40),
            guide: { name: long(20), role: long(20), line: long(40) },
          },
          contentNotes: { extraNote: long(80) },
        }),
        SECTION_IDS,
      );

      const fields: [string | null, number][] = [
        [page.hero.hook, 140],
        [page.hero.question, 100],
        [page.hero.courseLine, 200],
        [page.hero.buttonLabel, 32],
        [page.persona.name, 60],
        [page.persona.descriptor, 160],
        [page.firstMove.sceneLine, 80],
        [page.firstMove.personaLine, 240],
        [page.firstMove.prompt, 100],
        [page.firstMove.replies[0].text, 200],
        [page.firstMove.replies[0].label, 60],
        [page.firstMove.replies[0].why, 280],
        [page.arc.chapters[0].teaser, 160],
        [page.outcomes.items[0], 120],
        [page.cast.callerLine, 160],
        [page.cast.guide.name, 60],
        [page.cast.guide.role, 60],
        [page.cast.guide.line, 200],
        [page.contentNotes.extraNote, 300],
      ];
      for (const [value, max] of fields) {
        expect(value).not.toBeNull();
        expect((value as string).length).toBeLessThanOrEqual(max);
        // Whole words only: nothing ends mid-"listening".
        expect(value as string).toMatch(/^(listening )*listening$/);
      }
      expect(page.outcomes.items).toHaveLength(3);
    });

    it('keeps text under its limit exactly as written', () => {
      const page = normaliseLandingPageDraft(answer(), SECTION_IDS);
      expect(page.hero.question).toBe('Will you know what to say?');
    });
  });

  describe('chapters', () => {
    it('keeps only ids of sections that exist, in section order', () => {
      const page = normaliseLandingPageDraft(
        answer({
          arc: {
            chapters: [
              { sectionId: S2, beat: 'CONFLICT', teaser: 'two' },
              { sectionId: 'made-up', beat: 'SETUP', teaser: 'nope' },
              { sectionId: S1, beat: 'SETUP', teaser: 'one' },
            ],
            hardCallSectionId: S2,
          },
        }),
        SECTION_IDS,
      );
      expect(page.arc.chapters.map((chapter) => chapter.sectionId)).toEqual([
        S1,
        S2,
      ]);
      expect(JSON.stringify(page)).not.toContain('made-up');
    });

    it('reads a beat in any case and nulls one it does not know', () => {
      const page = normaliseLandingPageDraft(
        answer({
          arc: {
            chapters: [
              { sectionId: S1, beat: 'setup' },
              { sectionId: S2, beat: 'FINALE' },
            ],
            hardCallSectionId: S1,
          },
        }),
        SECTION_IDS,
      );
      expect(page.arc.chapters[0].beat).toBe(StoryBeat.SETUP);
      expect(page.arc.chapters[1].beat).toBeNull();
    });
  });

  describe('the hard call', () => {
    const withHardCall = (hardCallSectionId: unknown) =>
      normaliseLandingPageDraft(
        answer({ arc: { ...answer().arc, hardCallSectionId } }),
        SECTION_IDS,
      );

    it('keeps the one the model chose when it is a real section', () => {
      expect(withHardCall(S2).arc.hardCallSectionId).toBe(S2);
    });

    it.each([
      ['an unknown id', 'made-up'],
      ['nothing', undefined],
      ['null', null],
    ])('falls back to the climax chapter when the model gives %s', (_l, id) => {
      expect(withHardCall(id).arc.hardCallSectionId).toBe(S3);
    });

    it('falls back to the last section when there is no climax either', () => {
      const page = normaliseLandingPageDraft(
        answer({
          arc: {
            chapters: [
              { sectionId: S1, beat: 'SETUP' },
              { sectionId: S2, beat: 'CONFLICT' },
            ],
            hardCallSectionId: 'made-up',
          },
        }),
        SECTION_IDS,
      );
      expect(page.arc.hardCallSectionId).toBe(S3);
    });

    it('is exactly one, a single id, and null only for a course with no sections', () => {
      expect(typeof withHardCall(S1).arc.hardCallSectionId).toBe('string');
      const empty = normaliseLandingPageDraft(
        answer({ arc: { chapters: [], hardCallSectionId: S1 } }),
        [],
      );
      expect(empty.arc.hardCallSectionId).toBeNull();
      expect(empty.arc.chapters).toEqual([]);
    });
  });

  describe('first move', () => {
    it('drops a reply with no text and keeps at most four', () => {
      const reply = (n: number) => ({
        text: `Reply ${n}`,
        label: `Label ${n}`,
        why: null,
      });
      const page = normaliseLandingPageDraft(
        answer({
          firstMove: {
            ...answer().firstMove,
            replies: [
              { text: '', label: 'Empty' },
              reply(1),
              reply(2),
              reply(3),
              reply(4),
              reply(5),
            ],
          },
        }),
        SECTION_IDS,
      );
      expect(page.firstMove.replies.map((r) => r.text)).toEqual([
        'Reply 1',
        'Reply 2',
        'Reply 3',
        'Reply 4',
      ]);
    });
  });

  describe('outcomes and cast', () => {
    it('accepts outcomes as a bare array and keeps three non-empty ones', () => {
      const page = normaliseLandingPageDraft(
        answer({ outcomes: ['  ', 'One', 'Two', 'Three', 'Four'] }),
        SECTION_IDS,
      );
      expect(page.outcomes.items).toEqual(['One', 'Two', 'Three']);
    });

    it('drops the guide entirely when it has no name', () => {
      const page = normaliseLandingPageDraft(
        answer({
          cast: {
            callerLine: 'A line.',
            guide: { name: '', role: 'Supervisor', line: 'Orphan line.' },
          },
        }),
        SECTION_IDS,
      );
      expect(page.cast.guide).toEqual({ name: null, role: null, line: null });
      expect(page.cast.callerLine).toBe('A line.');
    });

    it('nulls a sitting length it does not know', () => {
      const page = normaliseLandingPageDraft(
        answer({ howItPlays: { sittingLength: 'FOREVER' } }),
        SECTION_IDS,
      );
      expect(page.howItPlays.sittingLength).toBeNull();
    });
  });

  describe('tone', () => {
    it('removes exclamation marks everywhere', () => {
      const page = normaliseLandingPageDraft(
        answer({
          hero: {
            hook: 'Meera texts at 2am! Tonight is different!!',
            question: 'Will you know what to say?!',
          },
          arc: {
            chapters: [{ sectionId: S1, beat: 'SETUP', teaser: 'Wow! Stop' }],
            hardCallSectionId: S1,
          },
        }),
        SECTION_IDS,
      );
      expect(page.hero.hook).toBe('Meera texts at 2am. Tonight is different.');
      expect(page.hero.question).toBe('Will you know what to say?');
      expect(page.arc.chapters[0].teaser).toBe('Wow. Stop');
      expect(JSON.stringify(page)).not.toContain('!');
    });
  });

  describe('what it asks the repair pass to fix', () => {
    it('throws when the answer has no hook', () => {
      const attempt = () =>
        normaliseLandingPageDraft(
          answer({ hero: { hook: '  ', question: 'q' } }),
          SECTION_IDS,
        );
      expect(attempt).toThrow(SpecialistValidationError);
      try {
        attempt();
      } catch (error) {
        expect((error as SpecialistValidationError).errors[0]).toMatch(
          /hero\.hook/,
        );
      }
    });

    it('throws when no chapter names a real section', () => {
      expect(() =>
        normaliseLandingPageDraft(
          answer({
            arc: {
              chapters: [{ sectionId: 'made-up', beat: 'SETUP' }],
              hardCallSectionId: 'made-up',
            },
          }),
          SECTION_IDS,
        ),
      ).toThrow(/arc\.chapters/);
    });

    it('does not need chapters for a course with no sections', () => {
      expect(() =>
        normaliseLandingPageDraft({ hero: { hook: 'A hook.' } }, []),
      ).not.toThrow();
    });
  });

  it('unwraps an answer nested under landingPage or draft', () => {
    expect(
      normaliseLandingPageDraft({ landingPage: answer() }, SECTION_IDS).hero
        .question,
    ).toBe('Will you know what to say?');
    expect(
      normaliseLandingPageDraft({ draft: answer() }, SECTION_IDS).hero.question,
    ).toBe('Will you know what to say?');
  });
});

describe('prompt context', () => {
  it('lists sections in order with ids, items and the roleplay scenario', () => {
    const outline = landingPageOutlineForPrompt([
      {
        id: S1,
        title: 'Listening first',
        description: '<p>Start <b>here</b>.</p>',
        items: [
          { type: 'ARTICLE', title: 'Name the feeling' },
          {
            type: 'ROLEPLAY',
            title: 'Asha goes quiet',
            scenario: { title: 'Asha, 19', story: 'A student, late at night.' },
          },
        ],
      },
    ]);
    expect(outline).toContain(
      `Section 1 (id: ${S1}): Listening first — Start here .`,
    );
    expect(outline).toContain('[Article] Name the feeling');
    expect(outline).toContain('[Roleplay] Asha goes quiet');
    expect(outline).toContain('Scenario: Asha, 19 — A student, late at night.');
  });

  it('says so when there are no sections', () => {
    expect(landingPageOutlineForPrompt([])).toMatch(/no sections/);
  });

  it('names each warning with the section numbers that carry it', () => {
    expect(
      triggerWarningsForPrompt(
        [
          { name: 'Suicide', sectionIds: [S3, S2] },
          { name: 'Grief', sectionIds: [S1] },
          { name: '  ', sectionIds: [S1] },
        ],
        SECTION_IDS,
      ),
    ).toBe('- Suicide (sections 2, 3)\n- Grief (section 1)');
    expect(triggerWarningsForPrompt([], SECTION_IDS)).toBe('(none)');
  });
});

describe('LandingPageSpecialist', () => {
  const input = (
    overrides: Partial<LandingPageInput> = {},
  ): LandingPageInput => ({
    trackId: 'track-1',
    title: 'Staying with the texter',
    description: 'A short course.',
    durationMinutes: 40,
    sections: SECTION_IDS.map((id, index) => ({
      id,
      title: `Section ${index + 1}`,
      items: [{ type: 'ROLEPLAY', title: `Roleplay ${index + 1}` }],
    })),
    triggerWarnings: [{ name: 'Suicide', sectionIds: [S3] }],
    currentPage: null,
    usageMetadata: { trackId: 'track-1' },
    ...overrides,
  });

  it('makes one call, with the registry row, prompt and usage metadata', async () => {
    const llm = fakeLlm([answer()], TEMPLATE);
    const draft = await new LandingPageSpecialist(llm.service).generate(
      input(),
    );

    expect(draft.hero.hook).toContain('Meera');
    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(llm.complete.mock.calls[0][0]).toMatchObject({
      promptCode: 'course_copilot_landing_page_writer',
      taskId: 'course-copilot-landing-page',
      task: 'course_copilot_landing_page',
      jsonMode: true,
      usageMetadata: { trackId: 'track-1', specialist: 'landing_page' },
    });
    const prompt = llm.promptOf(0);
    expect(prompt).toContain('title=Staying with the texter');
    expect(prompt).toContain(`id: ${S2}`);
    expect(prompt).toContain('- Suicide (section 3)');
    expect(prompt).toContain('current=(none yet)');
  });

  it('shows the writer the saved page without its image or character id', async () => {
    const llm = fakeLlm([answer()], TEMPLATE);
    const currentPage = normaliseTrackLandingPage({
      hero: { hook: 'Existing hook' },
      persona: {
        name: 'Meera, 19',
        imageUrl: 'https://example.com/meera.png',
        characterId: '00000000-0000-4000-8000-0000000000ff',
      },
    });
    await new LandingPageSpecialist(llm.service).generate(
      input({ currentPage }),
    );

    const prompt = llm.promptOf(0);
    expect(prompt).toContain('Existing hook');
    expect(prompt).toContain('Meera, 19');
    expect(prompt).not.toContain('meera.png');
    expect(prompt).not.toContain('0000000000ff');
  });

  it('repairs once: a first answer with no JSON, then a clean one', async () => {
    const llm = fakeLlm(
      ['I am sorry, here is a story instead.', answer()],
      TEMPLATE,
    );
    const draft = await new LandingPageSpecialist(llm.service).generate(
      input(),
    );

    expect(draft.hero.hook).toContain('Meera');
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.promptOf(1)).toContain('rejected for these reasons');
    expect(llm.promptOf(1)).toContain('The model did not return JSON');
    expect(llm.complete.mock.calls[1][0].usageMetadata).toMatchObject({
      repairPass: true,
    });
  });

  it('repairs once for an answer with no hook, passing the validator its errors', async () => {
    const llm = fakeLlm([answer({ hero: {} }), answer()], TEMPLATE);
    await new LandingPageSpecialist(llm.service).generate(input());

    expect(llm.promptOf(1)).toContain('hero.hook is missing');
  });

  it('gives up after the one repair pass', async () => {
    const llm = fakeLlm(['nope', 'still nope', answer()], TEMPLATE);
    await expect(
      new LandingPageSpecialist(llm.service).generate(input()),
    ).rejects.toBeInstanceOf(SpecialistValidationError);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('does not retry a provider failure', async () => {
    const llm = fakeLlm([answer()], TEMPLATE);
    llm.complete.mockReset().mockRejectedValue(new Error('provider down'));
    await expect(
      new LandingPageSpecialist(llm.service).generate(input()),
    ).rejects.toThrow('provider down');
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when the prompt row is missing', async () => {
    const llm = fakeLlm([answer()], null);
    await expect(
      new LandingPageSpecialist(llm.service).generate(input()),
    ).rejects.toThrow(/course_copilot_landing_page_writer/);
    expect(llm.complete).not.toHaveBeenCalled();
  });
});
