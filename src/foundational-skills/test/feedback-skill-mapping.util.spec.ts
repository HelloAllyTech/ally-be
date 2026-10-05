import { FHS_SKILL_KEYS } from '../constants/helping-skills-rubric.constants';
import { FEEDBACK_SKILL_MAPPER_MAX_ITEM_CHARS } from '../constants/feedback-skill-mapper.constants';
import {
  DebriefImprovement,
  buildMapperSystemPrompt,
  buildMapperUserPrompt,
  debriefImprovements,
  parseMapperReply,
} from '../util/feedback-skill-mapping.util';

/** Placeholder debrief text — synthetic, not from any session. */
const item = (
  index: number,
  improvement = `improvement ${index}`,
  recommendation: string | null = `recommendation ${index}`,
): DebriefImprovement => ({ index, improvement, recommendation });

describe('debriefImprovements', () => {
  it('reads areasOfGrowth with each recommendation, keeping positions', () => {
    expect(
      debriefImprovements({
        areasOfGrowth: [
          { improvement: ' first ', recommendation: 'do a' },
          { improvement: 'second', recommendation: '' },
        ],
        improvements: ['first', 'second'],
      }),
    ).toEqual([
      { index: 0, improvement: 'first', recommendation: 'do a' },
      { index: 1, improvement: 'second', recommendation: null },
    ]);
  });

  it('drops an item with no improvement text but keeps the others’ original index', () => {
    expect(
      debriefImprovements({
        areasOfGrowth: [
          { improvement: '   ', recommendation: 'x' },
          null,
          { improvement: 'third', recommendation: 'y' },
        ],
      }),
    ).toEqual([{ index: 2, improvement: 'third', recommendation: 'y' }]);
  });

  it('falls back to the legacy improvements[] strings when areasOfGrowth is absent or empty', () => {
    expect(
      debriefImprovements({ areasOfGrowth: [], improvements: ['a', 7, 'b'] }),
    ).toEqual([
      { index: 0, improvement: 'a', recommendation: null },
      { index: 2, improvement: 'b', recommendation: null },
    ]);
  });

  it('yields nothing, never throws, for anything that is not a debrief', () => {
    for (const value of [
      null,
      undefined,
      'text',
      42,
      [],
      { errorMessage: 'Session was too short. No summary generated.' },
      { areasOfGrowth: 'not an array' },
    ]) {
      expect(debriefImprovements(value)).toEqual([]);
    }
  });
});

describe('buildMapperSystemPrompt / buildMapperUserPrompt', () => {
  it('lists every rubric key and asks for one entry per item', () => {
    const prompt = buildMapperSystemPrompt();
    for (const key of FHS_SKILL_KEYS) expect(prompt).toContain(`"${key}"`);
    expect(prompt).toContain('{"items":[{"index":1');
    expect(prompt).toContain('or null');
    // Deterministic: part of the versioned mapping.
    expect(buildMapperSystemPrompt()).toBe(prompt);
  });

  it('numbers items from 1 in the order sent, with the recommendation when there is one', () => {
    const prompt = buildMapperUserPrompt([
      item(3, 'alpha', 'beta'),
      item(5, 'gamma', null),
    ]);
    expect(prompt).toContain('1. IMPROVEMENT: alpha\n   RECOMMENDATION: beta');
    expect(prompt).toContain('2. IMPROVEMENT: gamma');
    expect(prompt).not.toContain('2. IMPROVEMENT: gamma\n   RECOMMENDATION');
  });

  it('clips an outlier item to the per-item cap', () => {
    const long = 'z'.repeat(FEEDBACK_SKILL_MAPPER_MAX_ITEM_CHARS + 50);
    const prompt = buildMapperUserPrompt([item(0, long, null)]);
    expect(prompt).toContain(
      'z'.repeat(FEEDBACK_SKILL_MAPPER_MAX_ITEM_CHARS) + '…',
    );
    expect(prompt).not.toContain(
      'z'.repeat(FEEDBACK_SKILL_MAPPER_MAX_ITEM_CHARS + 1),
    );
  });
});

describe('parseMapperReply', () => {
  const sent = [item(0), item(2), item(4)];

  it('maps each entry back onto the sent item’s ORIGINAL index', () => {
    const reply = JSON.stringify({
      items: [
        { index: 1, skill: 'feelings' },
        { index: 2, skill: null },
        { index: 3, skill: 'goals' },
      ],
    });
    expect(parseMapperReply(reply, sent)).toEqual({
      items: [
        { index: 0, skill: 'feelings' },
        { index: 2, skill: null },
        { index: 4, skill: 'goals' },
      ],
      invalidKeys: 0,
    });
  });

  it('stores a key outside the rubric as null and counts it, never guesses', () => {
    const reply = JSON.stringify({
      items: [
        { index: 1, skill: 'Exploration and normalisation of feelings' },
        { index: 2, skill: 'empathyy' },
        { index: 3, skill: 42 },
      ],
    });
    expect(parseMapperReply(reply, sent)).toEqual({
      items: [
        { index: 0, skill: null },
        { index: 2, skill: null },
        { index: 4, skill: null },
      ],
      invalidKeys: 3,
    });
  });

  it('reads "none"/"null"/empty strings as no skill without counting them invalid', () => {
    const reply = JSON.stringify({
      items: [
        { index: 1, skill: 'none' },
        { index: 2, skill: 'null' },
        { index: 3, skill: ' ' },
      ],
    });
    const parsed = parseMapperReply(reply, sent);
    expect(parsed.items.map((i) => i.skill)).toEqual([null, null, null]);
    expect(parsed.invalidKeys).toBe(0);
  });

  it('accepts a fenced reply, string indexes and a trimmed key; the first duplicate wins', () => {
    const reply =
      '```json\n' +
      JSON.stringify({
        items: [
          { index: '1', skill: ' verbal ' },
          { index: 1, skill: 'harm' },
          { index: 2, skill: 'hope' },
          { index: 3, skill: 'coping' },
        ],
      }) +
      '\n```';
    expect(parseMapperReply(reply, sent).items).toEqual([
      { index: 0, skill: 'verbal' },
      { index: 2, skill: 'hope' },
      { index: 4, skill: 'coping' },
    ]);
  });

  it('throws when an item is left out — an incomplete answer, not "no skill"', () => {
    const reply = JSON.stringify({
      items: [
        { index: 1, skill: 'feelings' },
        { index: 3, skill: 'goals' },
      ],
    });
    expect(() => parseMapperReply(reply, sent)).toThrow(
      'Mapper reply omitted 1 of 3 items',
    );
  });

  it('throws on a reply that is not a JSON object with an items array', () => {
    for (const reply of ['not json', '[]', '{"skills":[]}', '{"items":"x"}']) {
      expect(() => parseMapperReply(reply, sent)).toThrow(/items/);
    }
  });
});
