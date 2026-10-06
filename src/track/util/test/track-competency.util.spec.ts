import {
  normaliseTrackCompetencyIds,
  resolveTrackCompetencyIds,
} from '../track-competency.util';

const SHARED_A = { id: 'a', isCustom: false };
const SHARED_B = { id: 'b', isCustom: false };
const CUSTOM_C = { id: 'c', isCustom: true };

describe('normaliseTrackCompetencyIds', () => {
  it('stores an empty or absent selection as NULL, never []', () => {
    expect(normaliseTrackCompetencyIds(undefined)).toBeNull();
    expect(normaliseTrackCompetencyIds(null)).toBeNull();
    expect(normaliseTrackCompetencyIds([])).toBeNull();
    expect(normaliseTrackCompetencyIds(['', null, undefined])).toBeNull();
  });

  it("dedupes and keeps the author's order", () => {
    expect(normaliseTrackCompetencyIds(['b', 'a', 'b', '', 'a'])).toEqual([
      'b',
      'a',
    ]);
  });
});

describe('resolveTrackCompetencyIds', () => {
  it('keeps new shared competencies that exist', () => {
    expect(
      resolveTrackCompetencyIds({
        requested: ['a', 'b'],
        stored: null,
        found: [SHARED_A, SHARED_B],
      }),
    ).toEqual({ ids: ['a', 'b'], rejected: [] });
  });

  it('rejects a new id that matches no competency', () => {
    expect(
      resolveTrackCompetencyIds({
        requested: ['a', 'missing'],
        stored: [],
        found: [SHARED_A],
      }),
    ).toEqual({ ids: ['a'], rejected: ['missing'] });
  });

  it('rejects a new custom competency (private, and never read by Course impact)', () => {
    expect(
      resolveTrackCompetencyIds({
        requested: ['a', 'c'],
        stored: [],
        found: [SHARED_A, CUSTOM_C],
      }),
    ).toEqual({ ids: ['a'], rejected: ['c'] });
  });

  it('silently drops an already-stored id whose competency was deleted', () => {
    expect(
      resolveTrackCompetencyIds({
        requested: ['a', 'gone'],
        stored: ['a', 'gone'],
        found: [SHARED_A],
      }),
    ).toEqual({ ids: ['a'], rejected: [] });
  });

  it('never rejects an id the course already carries', () => {
    expect(
      resolveTrackCompetencyIds({
        requested: ['c'],
        stored: ['c'],
        found: [CUSTOM_C],
      }),
    ).toEqual({ ids: ['c'], rejected: [] });
  });

  it('returns NULL when nothing survives, so the analytics fallback applies', () => {
    expect(
      resolveTrackCompetencyIds({
        requested: ['gone'],
        stored: ['gone'],
        found: [],
      }),
    ).toEqual({ ids: null, rejected: [] });
    expect(
      resolveTrackCompetencyIds({ requested: [], stored: ['a'], found: [] }),
    ).toEqual({ ids: null, rejected: [] });
  });
});
