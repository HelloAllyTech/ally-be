import { SimulationState } from '../../type/simulation-state.type';
import { validateSimulationStates } from '../validate-simulation-states.util';

/**
 * Build a SimulationState with sensible defaults. The starting state is
 * emergent (the range containing 0), so there is intentionally no
 * `isStarting` field to set.
 */
const state = (over: Partial<SimulationState> = {}): SimulationState => ({
  id: 'id-1',
  name: 'State',
  guidelines: 'guidance',
  scoreLower: 0,
  scoreUpper: 50,
  ragEnabled: true,
  // Spread last so an explicit `null` bound overrides the default (a `??`
  // default would silently swallow it).
  ...over,
});

describe('validateSimulationStates', () => {
  it('treats empty / unset as valid (only hasStates prompts require non-empty)', () => {
    expect(validateSimulationStates(undefined)).toEqual([]);
    expect(validateSimulationStates(null)).toEqual([]);
    expect(validateSimulationStates([])).toEqual([]);
  });

  it('accepts a single state of any width >= the min gap', () => {
    expect(
      validateSimulationStates([
        state({ id: 'a', scoreLower: 0, scoreUpper: 100 }),
      ]),
    ).toEqual([]);
  });

  it('accepts n contiguous states', () => {
    const states = [
      state({ id: 'a', scoreLower: 0, scoreUpper: 50 }),
      state({ id: 'b', scoreLower: 50, scoreUpper: 120 }),
      state({ id: 'c', scoreLower: 120, scoreUpper: 200 }),
    ];
    expect(validateSimulationStates(states)).toEqual([]);
  });

  it('validates regardless of input ordering (sorts by scoreLower)', () => {
    const states = [
      state({ id: 'c', scoreLower: 120, scoreUpper: 200 }),
      state({ id: 'a', scoreLower: 0, scoreUpper: 50 }),
      state({ id: 'b', scoreLower: 50, scoreUpper: 120 }),
    ];
    expect(validateSimulationStates(states)).toEqual([]);
  });

  it('does NOT require a starting state (emergent from the 0-range)', () => {
    // A perfectly contiguous set with no "starting" concept is valid.
    const states = [
      state({ id: 'a', scoreLower: 0, scoreUpper: 50 }),
      state({ id: 'b', scoreLower: 50, scoreUpper: 100 }),
    ];
    expect(validateSimulationStates(states)).toEqual([]);
  });

  it('rejects a gap between ranges', () => {
    const states = [
      state({ id: 'a', scoreLower: 0, scoreUpper: 50 }),
      state({ id: 'b', scoreLower: 60, scoreUpper: 120 }),
    ];
    const errors = validateSimulationStates(states);
    expect(errors.some((e) => e.includes('contiguous'))).toBe(true);
  });

  it('rejects overlapping ranges (non-contiguous boundary)', () => {
    const states = [
      state({ id: 'a', scoreLower: 0, scoreUpper: 80 }),
      state({ id: 'b', scoreLower: 50, scoreUpper: 120 }),
    ];
    const errors = validateSimulationStates(states);
    expect(errors.some((e) => e.includes('contiguous'))).toBe(true);
  });

  it('rejects a range narrower than the min gap (50)', () => {
    const errors = validateSimulationStates([
      state({ id: 'a', scoreLower: 0, scoreUpper: 40 }),
    ]);
    expect(errors.some((e) => e.includes('smaller than 50'))).toBe(true);
  });

  it('accepts a range exactly equal to the min gap', () => {
    expect(
      validateSimulationStates([
        state({ id: 'a', scoreLower: 0, scoreUpper: 50 }),
      ]),
    ).toEqual([]);
  });

  it('rejects a missing (null) bound', () => {
    const errors = validateSimulationStates([
      state({ id: 'a', scoreLower: 0, scoreUpper: null }),
    ]);
    expect(errors.some((e) => e.includes('missing scoreUpper'))).toBe(true);
  });

  it('rejects duplicate and missing ids', () => {
    const dup = validateSimulationStates([
      state({ id: 'a', scoreLower: 0, scoreUpper: 50 }),
      state({ id: 'a', scoreLower: 50, scoreUpper: 100 }),
    ]);
    expect(dup.some((e) => e.includes('Duplicate state id'))).toBe(true);

    const missing = validateSimulationStates([
      state({ id: '', scoreLower: 0, scoreUpper: 50 }),
    ]);
    expect(missing.some((e) => e.includes('must have an id'))).toBe(true);
  });
});
