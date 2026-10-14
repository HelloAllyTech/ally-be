import { CourseCopilotBriefService } from '../course-copilot-brief.service';
import { JsonPatchError } from 'src/common/util/json-patch.util';
import { COURSE_COPILOT_LIMITS } from '../../constants/course-copilot.constants';
import { CourseBrief } from '../../type/course-copilot.type';

/**
 * The brief is a document the MODEL writes, so these specs pin the leniency
 * contract: coerce where the intent is unambiguous, drop (and report) what is
 * not, and never let a patch lose something the trainer said.
 */
describe('CourseCopilotBriefService', () => {
  let service: CourseCopilotBriefService;

  /** A brief that clears the readiness guard on every field. */
  const readyBrief = (): CourseBrief => ({
    seed: 'Keep a reluctant texter talking',
    audience: { who: 'First-month volunteers' },
    outcomes: { terminal: 'Assess risk with a reluctant texter' },
    competencyIds: ['c-1'],
    assessment: { kind: 'roleplay' },
    shape: { durationMinutes: 60, languageIds: ['1'] },
  });

  beforeEach(() => {
    service = new CourseCopilotBriefService();
  });

  describe('applyPatch', () => {
    it('writes into containers that do not exist yet on an empty brief', () => {
      // The model's first patch is usually `add /audience/who`. Without the
      // seeded containers that throws "segment does not exist" and costs a
      // whole tool round-trip.
      const { brief, ignoredKeys } = service.applyPatch({}, [
        { op: 'add', path: '/seed', value: 'Teach de-escalation' },
        { op: 'add', path: '/audience/who', value: 'New volunteers' },
        { op: 'add', path: '/outcomes/terminal', value: 'Calm a caller' },
        { op: 'add', path: '/competencyIds/-', value: 'c-9' },
        { op: 'add', path: '/notes/-', value: 'Mention the 24h rule' },
      ]);

      expect(brief).toEqual({
        seed: 'Teach de-escalation',
        audience: { who: 'New volunteers' },
        outcomes: { terminal: 'Calm a caller' },
        competencyIds: ['c-9'],
        notes: ['Mention the 24h rule'],
      });
      expect(ignoredKeys).toEqual([]);
    });

    it('does not mutate the brief it was given', () => {
      const current: CourseBrief = { seed: 'before' };
      service.applyPatch(current, [
        { op: 'replace', path: '/seed', value: 'after' },
      ]);
      expect(current).toEqual({ seed: 'before' });
    });

    it('tolerates a null current brief (a session row before the first patch)', () => {
      const { brief } = service.applyPatch(null as any, [
        { op: 'add', path: '/seed', value: 'x' },
      ]);
      expect(brief).toEqual({ seed: 'x' });
    });

    it('coerces numbers that arrive as strings', () => {
      // "60" for durationMinutes is the commonest model slip.
      const { brief } = service.applyPatch({}, [
        { op: 'add', path: '/shape/durationMinutes', value: '60' },
        { op: 'add', path: '/shape/sections', value: '3' },
        { op: 'add', path: '/assessment/threshold', value: '75' },
      ]);
      expect(brief.shape).toEqual({ durationMinutes: 60, sections: 3 });
      expect(brief.assessment).toEqual({ threshold: 75 });
    });

    it('rounds fractional durations and drops zero / negative / non-numeric ones', () => {
      const run = (value: unknown) =>
        service.applyPatch({}, [
          { op: 'add', path: '/shape/durationMinutes', value },
        ]).brief.shape?.durationMinutes;
      expect(run(89.6)).toBe(90);
      expect(run(0)).toBeUndefined();
      expect(run(-30)).toBeUndefined();
      expect(run('an hour')).toBeUndefined();
      expect(run(null)).toBeUndefined();
    });

    it('caps sections at the platform limit', () => {
      const { brief } = service.applyPatch({}, [
        { op: 'add', path: '/shape/sections', value: 99 },
      ]);
      expect(brief.shape?.sections).toBe(COURSE_COPILOT_LIMITS.sections);
    });

    it('drops invalid enum values instead of storing them', () => {
      const { brief } = service.applyPatch({}, [
        { op: 'add', path: '/assessment/kind', value: 'essay' },
        { op: 'add', path: '/shape/practiceWeight', value: 'mostly-roleplay' },
        { op: 'add', path: '/look/cover', value: 'stock-photo' },
        { op: 'add', path: '/look/articleImages', value: 'many' },
        {
          op: 'add',
          path: '/shape/components',
          value: ['article', 'podcast', 'quiz'],
        },
      ]);
      // Nothing valid in assessment/look/practiceWeight → the containers vanish
      // rather than being stored empty.
      expect(brief.assessment).toBeUndefined();
      expect(brief.look).toBeUndefined();
      expect(brief.shape).toEqual({ components: ['article', 'quiz'] });
    });

    it('keeps valid enum values', () => {
      const { brief } = service.applyPatch({}, [
        { op: 'add', path: '/assessment/kind', value: 'annotated_artifact' },
        { op: 'add', path: '/shape/practiceWeight', value: 'practice-heavy' },
        { op: 'add', path: '/look/cover', value: 'upload-later' },
        { op: 'add', path: '/look/articleImages', value: 'one-per-article' },
      ]);
      expect(brief.assessment?.kind).toBe('annotated_artifact');
      expect(brief.shape?.practiceWeight).toBe('practice-heavy');
      expect(brief.look).toEqual({
        cover: 'upload-later',
        articleImages: 'one-per-article',
      });
    });

    it('drops non-numeric language ids and stringifies numeric ones', () => {
      // `languages.id` is numeric; "Hindi" would later fail a lookup.
      const { brief } = service.applyPatch({}, [
        {
          op: 'add',
          path: '/shape/languageIds',
          value: ['1', 'hi', 2, '3a', ' 4 '],
        },
      ]);
      expect(brief.shape?.languageIds).toEqual(['1', '2', '4']);
    });

    it('drops the language list entirely when nothing in it is numeric', () => {
      const { brief } = service.applyPatch({}, [
        { op: 'add', path: '/shape/languageIds', value: ['english'] },
      ]);
      expect(brief.shape).toBeUndefined();
    });

    it('wraps a lone string where a list is expected', () => {
      const { brief } = service.applyPatch({}, [
        { op: 'add', path: '/outcomes/enabling', value: 'Ask open questions' },
        { op: 'add', path: '/competencyIds', value: 'c-3' },
      ]);
      expect(brief.outcomes?.enabling).toEqual(['Ask open questions']);
      expect(brief.competencyIds).toEqual(['c-3']);
    });

    it('trims strings and drops blank ones', () => {
      const { brief } = service.applyPatch({}, [
        { op: 'add', path: '/seed', value: '   ' },
        { op: 'add', path: '/audience/who', value: '  Volunteers  ' },
        { op: 'add', path: '/audience/groupNote', value: '' },
      ]);
      expect(brief.seed).toBeUndefined();
      expect(brief.audience).toEqual({ who: 'Volunteers' });
    });

    it('caps enabling outcomes at 8 and competencies at the platform limit', () => {
      const { brief } = service.applyPatch({}, [
        {
          op: 'add',
          path: '/outcomes/enabling',
          value: Array.from({ length: 12 }, (_, i) => `outcome ${i}`),
        },
        {
          op: 'add',
          path: '/competencyIds',
          value: Array.from({ length: 30 }, (_, i) => `c-${i}`),
        },
      ]);
      expect(brief.outcomes?.enabling).toHaveLength(8);
      expect(brief.competencyIds).toHaveLength(
        COURSE_COPILOT_LIMITS.competencies,
      );
    });

    describe('ignoredKeys', () => {
      it('reports undeclared top-level keys and does not store them', () => {
        // The Builder lesson: an agent told only "ok" keeps writing a key
        // nobody stores. Reporting it back is the whole point.
        const { brief, ignoredKeys } = service.applyPatch({}, [
          { op: 'add', path: '/seed', value: 'real' },
          { op: 'add', path: '/mood', value: 'upbeat' },
          { op: 'add', path: '/budget', value: { usd: 5 } },
        ]);
        expect(ignoredKeys.sort()).toEqual(['budget', 'mood']);
        expect(brief).toEqual({ seed: 'real' });
        expect(brief).not.toHaveProperty('mood');
      });

      it('does not flag the containers the service seeds itself', () => {
        const { ignoredKeys } = service.applyPatch({}, []);
        expect(ignoredKeys).toEqual([]);
      });
    });

    describe('notes only grow', () => {
      const withNotes: CourseBrief = { notes: ['first', 'second'] };

      it('throws when a replace would shrink the list', () => {
        expect(() =>
          service.applyPatch(withNotes, [
            { op: 'replace', path: '/notes', value: ['first'] },
          ]),
        ).toThrow(/would drop 1 note/);
      });

      it('throws when an element is removed', () => {
        expect(() =>
          service.applyPatch(withNotes, [{ op: 'remove', path: '/notes/0' }]),
        ).toThrow(/Notes only grow/);
      });

      it('tells the model what to do instead', () => {
        expect(() =>
          service.applyPatch(withNotes, [
            { op: 'replace', path: '/notes', value: [] },
          ]),
        ).toThrow(/\/notes\/-/);
      });

      it('allows appending and rewording in place', () => {
        const { brief } = service.applyPatch(withNotes, [
          { op: 'add', path: '/notes/-', value: 'third' },
          { op: 'replace', path: '/notes/0', value: 'first, reworded' },
        ]);
        expect(brief.notes).toEqual(['first, reworded', 'second', 'third']);
      });

      it('lets a brief with no notes stay that way', () => {
        expect(() => service.applyPatch({}, [])).not.toThrow();
      });
    });

    it('propagates a JsonPatchError for a replace on a missing member', () => {
      // `replace` requires the target to exist; the model needs the op index.
      expect.assertions(2);
      try {
        service.applyPatch({}, [
          { op: 'replace', path: '/audience/who', value: 'x' },
        ]);
      } catch (error) {
        expect(error).toBeInstanceOf(JsonPatchError);
        expect((error as JsonPatchError).opIndex).toBe(0);
      }
    });

    it('returns readiness for the patched brief', () => {
      const { readiness } = service.applyPatch({}, [
        { op: 'add', path: '/seed', value: 'x' },
      ]);
      expect(readiness.ready).toBe(false);
      expect(readiness.missing).not.toContain('what the course is for');
    });
  });

  describe('readiness', () => {
    it('lists every field on an empty brief, in interview order', () => {
      expect(service.readiness({})).toEqual({
        ready: false,
        missing: [
          'what the course is for',
          'who the learners are',
          'the end-of-course outcome',
          'at least one competency',
          'how mastery is assessed',
          'the time budget',
          'the language',
        ],
      });
    });

    it.each([
      ['seed', (b: CourseBrief) => delete b.seed, 'what the course is for'],
      [
        'audience.who',
        (b: CourseBrief) => delete b.audience,
        'who the learners are',
      ],
      [
        'outcomes.terminal',
        (b: CourseBrief) => delete b.outcomes,
        'the end-of-course outcome',
      ],
      [
        'competencyIds',
        (b: CourseBrief) => {
          b.competencyIds = [];
        },
        'at least one competency',
      ],
      [
        'assessment.kind',
        (b: CourseBrief) => delete b.assessment,
        'how mastery is assessed',
      ],
      [
        'shape.durationMinutes',
        (b: CourseBrief) => {
          b.shape = { languageIds: ['1'] };
        },
        'the time budget',
      ],
      [
        'shape.languageIds',
        (b: CourseBrief) => {
          b.shape = { durationMinutes: 60, languageIds: [] };
        },
        'the language',
      ],
    ])(
      'reports exactly %s when only that field is missing',
      (_name, strip, label) => {
        const brief = readyBrief();
        strip(brief);
        expect(service.readiness(brief)).toEqual({
          ready: false,
          missing: [label],
        });
      },
    );

    it('is ready when every required field is present', () => {
      expect(service.readiness(readyBrief())).toEqual({
        ready: true,
        missing: [],
      });
    });

    it('does not require optional fields (practice, look, notes)', () => {
      // Readiness is clearance, not a score: optional fields never block.
      const brief = readyBrief();
      expect(brief.practice).toBeUndefined();
      expect(service.readiness(brief).ready).toBe(true);
    });

    it('treats null / undefined as an empty brief', () => {
      expect(service.readiness(null).ready).toBe(false);
      expect(service.readiness(undefined).missing).toHaveLength(7);
    });

    it('reaches ready through applyPatch alone (the model can only patch)', () => {
      const { readiness } = service.applyPatch({}, [
        { op: 'add', path: '/seed', value: 'x' },
        { op: 'add', path: '/audience/who', value: 'y' },
        { op: 'add', path: '/outcomes/terminal', value: 'z' },
        { op: 'add', path: '/competencyIds/-', value: 'c-1' },
        { op: 'add', path: '/assessment/kind', value: 'quiz' },
        { op: 'add', path: '/shape/durationMinutes', value: '45' },
        { op: 'add', path: '/shape/languageIds', value: ['1'] },
      ]);
      expect(readiness).toEqual({ ready: true, missing: [] });
    });
  });

  describe('practice slots', () => {
    const slotsOf = (practice: unknown[]) =>
      service.applyPatch({}, [
        { op: 'add', path: '/practice', value: practice },
      ]).brief.practice;

    it('turns a library slot with no scenario or case id into a new one', () => {
      // "library" with nothing to point at would later fail the build job; it
      // is far more useful as a roleplay to generate.
      expect(
        slotsOf([{ source: 'library', personaBrief: 'Asha, 19' }]),
      ).toEqual([{ slot: 1, source: 'new', personaBrief: 'Asha, 19' }]);
    });

    it('keeps a library slot that names a scenario, coercing the id', () => {
      expect(
        slotsOf([{ slot: 2, source: 'library', scenarioId: '42' }]),
      ).toEqual([{ slot: 2, source: 'library', scenarioId: 42 }]);
    });

    it('keeps a library slot that names a case', () => {
      expect(slotsOf([{ source: 'library', caseId: 'case-1' }])).toEqual([
        { slot: 1, source: 'library', caseId: 'case-1' },
      ]);
    });

    it('drops scenario / case ids from a slot that is new', () => {
      // A "new" slot must not carry a library reference: the blueprint planner
      // reads scenarioId as "reuse this".
      expect(
        slotsOf([
          {
            source: 'new',
            scenarioId: 7,
            caseId: 'case-1',
            taskClass: 'cooperative',
          },
        ]),
      ).toEqual([{ slot: 1, source: 'new', taskClass: 'cooperative' }]);
    });

    it('treats an unknown source as new', () => {
      expect(slotsOf([{ source: 'marketplace' }])).toEqual([
        { slot: 1, source: 'new' },
      ]);
    });

    it('defaults slot numbers to the array position and keeps explicit ones', () => {
      const slots = slotsOf([{}, { slot: 5 }, {}]);
      expect(slots?.map((s) => s.slot)).toEqual([1, 5, 3]);
    });

    it('clamps minScore into 0-100 and keeps a zero (no gate)', () => {
      const slots = slotsOf([
        { minScore: 150 },
        { minScore: -20 },
        { minScore: 0 },
        { minScore: '65' },
      ]);
      expect(slots?.map((s) => s.minScore)).toEqual([100, 0, 0, 65]);
    });

    it('only keeps saveCharacter when it is literally true', () => {
      const slots = slotsOf([
        { saveCharacter: true },
        { saveCharacter: 'yes' },
      ]);
      expect(slots?.[0].saveCharacter).toBe(true);
      expect(slots?.[1]).not.toHaveProperty('saveCharacter');
    });

    it('carries character, trigger warnings and persona through', () => {
      expect(
        slotsOf([
          {
            characterId: 'char-1',
            personaBrief: 'Dev, 40',
            triggerWarningIds: ['tw-1', ' ', 'tw-2'],
          },
        ]),
      ).toEqual([
        {
          slot: 1,
          source: 'new',
          characterId: 'char-1',
          personaBrief: 'Dev, 40',
          triggerWarningIds: ['tw-1', 'tw-2'],
        },
      ]);
    });

    it('drops non-object entries and caps the list at 12', () => {
      const slots = slotsOf([
        null,
        'slot',
        3,
        ...Array.from({ length: 20 }, () => ({})),
      ]);
      expect(slots).toHaveLength(12);
    });

    it('omits the practice key when nothing survives', () => {
      const { brief } = service.applyPatch({}, [
        { op: 'add', path: '/practice', value: [null, 'x'] },
      ]);
      expect(brief).not.toHaveProperty('practice');
    });

    it('ignores a practice value that is not an array', () => {
      const { brief } = service.applyPatch({}, [
        { op: 'add', path: '/practice', value: { slot: 1 } },
      ]);
      expect(brief).not.toHaveProperty('practice');
    });
  });

  describe('video links', () => {
    const videosOf = (value: unknown) =>
      service.applyPatch({}, [{ op: 'add', path: '/videoUrls', value }]).brief
        .videoUrls;

    it('keeps http(s) links, defaulting the title and inferring the source', () => {
      expect(
        videosOf([
          { url: 'https://www.youtube.com/watch?v=abc' },
          { url: 'https://youtu.be/abc', title: 'Short link' },
          { url: 'https://vimeo.com/123' },
          { url: 'https://www.loom.com/share/x' },
          { url: 'https://cdn.example.org/clip.mp4', durationSeconds: '90' },
        ]),
      ).toEqual([
        {
          title: 'Video',
          url: 'https://www.youtube.com/watch?v=abc',
          source: 'youtube',
        },
        { title: 'Short link', url: 'https://youtu.be/abc', source: 'youtube' },
        { title: 'Video', url: 'https://vimeo.com/123', source: 'vimeo' },
        { title: 'Video', url: 'https://www.loom.com/share/x', source: 'loom' },
        {
          title: 'Video',
          url: 'https://cdn.example.org/clip.mp4',
          source: 's3',
          durationSeconds: 90,
        },
      ]);
    });

    it('honours an explicit valid source over the inferred one', () => {
      expect(
        videosOf([{ url: 'https://example.org/v', source: 'loom' }])?.[0]
          .source,
      ).toBe('loom');
    });

    it('drops links that are not http(s) URLs', () => {
      // A javascript: or bare-hostname "link" must never reach a VIDEO item.
      expect(
        videosOf([
          { url: 'javascript:alert(1)' },
          { url: 'youtube.com/watch?v=abc' },
          { title: 'No url' },
          null,
        ]),
      ).toBeUndefined();
    });

    it('caps the list at 10', () => {
      const many = Array.from({ length: 14 }, (_, i) => ({
        url: `https://example.org/${i}`,
      }));
      expect(videosOf(many)).toHaveLength(10);
    });
  });

  describe('inferVideoSource', () => {
    it.each([
      ['https://www.youtube.com/watch?v=1', 'youtube'],
      ['https://youtu.be/1', 'youtube'],
      ['https://player.vimeo.com/video/1', 'vimeo'],
      ['https://www.loom.com/share/1', 'loom'],
      ['https://bucket.s3.amazonaws.com/a.mp4', 's3'],
      ['not a url', 's3'],
    ])('%s → %s', (url, expected) => {
      expect(service.inferVideoSource(url)).toBe(expected);
    });
  });

  describe('normalise', () => {
    it('returns an empty brief for garbage input', () => {
      expect(service.normalise(null)).toEqual({});
      expect(service.normalise('seed')).toEqual({});
      expect(service.normalise(42)).toEqual({});
    });

    it('is idempotent — a stored brief normalises to itself', () => {
      // Every patch re-normalises the whole stored document, so a second pass
      // must not change anything or the brief would drift on each turn.
      const once = service.normalise({
        ...readyBrief(),
        practice: [{ source: 'library', scenarioId: 3, minScore: 70 }],
        videoUrls: [{ url: 'https://youtu.be/x' }],
        look: { cover: 'generate' },
        notes: ['a'],
      });
      expect(service.normalise(once)).toEqual(once);
    });
  });
});
