import {
  CALIBRATION_TOO_EASY_TOP_BAND_PCT,
  CALIBRATION_TOO_HARD_BELOW_ZERO_PCT,
  DERIVED_SCORE_BANDS,
  RAW_SCORE_BANDS,
  ScoringContributor,
  TOP_BAND_KEY,
  calibrationFlag,
  deriveAttainableRange,
  derivedBandKey,
  isRangeSuspect,
  rawBandKey,
  scoreShareOfMax,
} from '../scenario-score-range.util';

const event = (
  score: number | null,
  maxOccurrences?: number | null,
): ScoringContributor => ({ kind: 'event', score, maxOccurrences });
const behaviour = (score: number): ScoringContributor => ({
  kind: 'behaviour',
  score,
  maxOccurrences: null,
});

describe('deriveAttainableRange', () => {
  it('sums positive score × maxOccurrences into a HARD ceiling when every positive event is capped', () => {
    const range = deriveAttainableRange([
      event(10, 3),
      event(5, 2),
      event(-4, 2),
    ]);
    expect(range).toEqual({
      derivable: true,
      max: 40,
      min: -8,
      ceilingIsHard: true,
      floorIsHard: true,
      uncappedPositive: 0,
      uncappedNegative: 0,
      positiveContributors: 2,
      negativeContributors: 1,
    });
  });

  it('counts an event with no maxOccurrences ONCE and says the ceiling is nominal', () => {
    const missing = deriveAttainableRange([event(10, 3), event(20)]);
    expect(missing.max).toBe(50);
    expect(missing.ceilingIsHard).toBe(false);
    expect(missing.uncappedPositive).toBe(1);

    const explicitNull = deriveAttainableRange([event(20, null)]);
    expect(explicitNull.max).toBe(20);
    expect(explicitNull.uncappedPositive).toBe(1);
  });

  it('counts behaviour instructions once each — the runtime never caps them', () => {
    const range = deriveAttainableRange([
      event(10, 2),
      behaviour(10),
      behaviour(10),
      behaviour(-10),
    ]);
    expect(range.max).toBe(40);
    expect(range.min).toBe(-10);
    expect(range.uncappedPositive).toBe(2);
    expect(range.uncappedNegative).toBe(1);
    expect(range.ceilingIsHard).toBe(false);
    expect(range.floorIsHard).toBe(false);
  });

  it('ignores a contributor that cannot score: null or 0 points, or a cap of 0', () => {
    const range = deriveAttainableRange([
      event(null, 5),
      event(0, 5),
      event(30, 0),
      event(10, 1),
    ]);
    expect(range.max).toBe(10);
    expect(range.positiveContributors).toBe(1);
    expect(range.ceilingIsHard).toBe(true);
  });

  it('floors a fractional cap, as the worker does', () => {
    expect(deriveAttainableRange([event(10, 2.7)]).max).toBe(20);
  });

  it('is not derivable with nothing that adds points', () => {
    for (const contributors of [[], [event(-5, 2)], [behaviour(-10)]]) {
      const range = deriveAttainableRange(contributors);
      expect(range.derivable).toBe(false);
      expect(range.max).toBeNull();
      expect(range.min).toBeNull();
      expect(range.ceilingIsHard).toBe(false);
    }
  });
});

describe('scoreShareOfMax', () => {
  const range = deriveAttainableRange([event(25, 4)]); // max 100

  it('reads a score as a fraction of the max, negatives stay negative', () => {
    expect(scoreShareOfMax(50, range)).toBe(0.5);
    expect(scoreShareOfMax(-20, range)).toBe(-0.2);
    expect(scoreShareOfMax(130, range)).toBe(1.3);
  });

  it('is null without a derivable range', () => {
    expect(scoreShareOfMax(50, deriveAttainableRange([]))).toBeNull();
    expect(scoreShareOfMax(50, null)).toBeNull();
  });
});

describe('band edges', () => {
  it('derived: quarters half-open, top band closed at 100%, above it its own band', () => {
    const max = 80;
    expect(derivedBandKey(-1, max)).toBe('below0');
    expect(derivedBandKey(0, max)).toBe('pct0to25');
    expect(derivedBandKey(19.99, max)).toBe('pct0to25');
    expect(derivedBandKey(20, max)).toBe('pct25to50');
    expect(derivedBandKey(40, max)).toBe('pct50to75');
    expect(derivedBandKey(60, max)).toBe('pct75to100');
    expect(derivedBandKey(80, max)).toBe('pct75to100');
    expect(derivedBandKey(80.5, max)).toBe('over100');
  });

  it('raw: < 0, 0–49, 50–99, 100+', () => {
    expect(rawBandKey(-0.5)).toBe('below0');
    expect(rawBandKey(0)).toBe('raw0to49');
    expect(rawBandKey(49.9)).toBe('raw0to49');
    expect(rawBandKey(50)).toBe('raw50to99');
    expect(rawBandKey(99)).toBe('raw50to99');
    expect(rawBandKey(100)).toBe('raw100plus');
  });

  it('every band key the classifiers return is a defined band, top bands included', () => {
    const derived = DERIVED_SCORE_BANDS.map((b) => b.key) as string[];
    const raw = RAW_SCORE_BANDS.map((b) => b.key) as string[];
    expect(derived).toContain(TOP_BAND_KEY.derived);
    expect(raw).toContain(TOP_BAND_KEY.raw);
    for (const s of [-5, 0, 10, 30, 60, 100, 200]) {
      expect(derived).toContain(derivedBandKey(s, 100));
      expect(raw).toContain(rawBandKey(s));
    }
  });
});

describe('calibrationFlag', () => {
  it('flags too easy only ABOVE the top-band threshold', () => {
    expect(CALIBRATION_TOO_EASY_TOP_BAND_PCT).toBe(80);
    expect(calibrationFlag(81, 0, 100)).toBe('tooEasy');
    expect(calibrationFlag(80, 0, 100)).toBeNull();
  });

  it('flags too hard only ABOVE the below-zero threshold', () => {
    expect(CALIBRATION_TOO_HARD_BELOW_ZERO_PCT).toBe(50);
    expect(calibrationFlag(0, 51, 100)).toBe('tooHard');
    expect(calibrationFlag(0, 50, 100)).toBeNull();
  });

  it('gives no verdict over no sessions', () => {
    expect(calibrationFlag(0, 0, 0)).toBeNull();
  });
});

describe('isRangeSuspect', () => {
  it('marks sessions above a HARD ceiling, not above a nominal one', () => {
    const hard = deriveAttainableRange([event(10, 2)]);
    const nominal = deriveAttainableRange([event(10)]);
    expect(isRangeSuspect(hard, 1)).toBe(true);
    expect(isRangeSuspect(hard, 0)).toBe(false);
    expect(isRangeSuspect(nominal, 5)).toBe(false);
  });
});
