import {
  buildGeneratedStates,
  GENERATED_STATE_WIDTH,
  MAX_GENERATED_STATES,
} from '../build-generated-states.util';
import { validateSimulationStates } from '../validate-simulation-states.util';

describe('buildGeneratedStates', () => {
  const goodInput = [
    { name: 'Guarded', guidelines: 'You are wary.', ragEnabled: false },
    { name: 'Opening up', guidelines: 'You share a little.', ragEnabled: true },
    { name: 'Trusting', guidelines: 'You speak freely.', ragEnabled: true },
  ];

  it('returns [] for non-array / empty / unusable input', () => {
    expect(buildGeneratedStates(undefined)).toEqual([]);
    expect(buildGeneratedStates(null)).toEqual([]);
    expect(buildGeneratedStates('nope')).toEqual([]);
    expect(buildGeneratedStates([])).toEqual([]);
    // Entries missing name or guidelines are dropped, leaving nothing.
    expect(buildGeneratedStates([{ name: 'x' }, { guidelines: 'y' }])).toEqual(
      [],
    );
  });

  it('assigns contiguous score bands and preserves order', () => {
    const states = buildGeneratedStates(goodInput);
    expect(states).toHaveLength(3);
    expect(states.map((s) => s.name)).toEqual([
      'Guarded',
      'Opening up',
      'Trusting',
    ]);
    expect(states.map((s) => [s.scoreLower, s.scoreUpper])).toEqual([
      [0, GENERATED_STATE_WIDTH],
      [GENERATED_STATE_WIDTH, 2 * GENERATED_STATE_WIDTH],
      [2 * GENERATED_STATE_WIDTH, 3 * GENERATED_STATE_WIDTH],
    ]);
  });

  it('produces a set that passes the save-path validator', () => {
    const states = buildGeneratedStates(goodInput);
    expect(validateSimulationStates(states)).toEqual([]);
    // First band opens at 0 → it is the emergent starting state.
    expect(states[0].scoreLower).toBe(0);
  });

  it('mints unique stable ids', () => {
    const states = buildGeneratedStates(goodInput);
    const ids = states.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(typeof id).toBe('string'));
  });

  it('defaults ragEnabled to true when omitted or non-boolean', () => {
    const states = buildGeneratedStates([
      { name: 'A', guidelines: 'g' },
      { name: 'B', guidelines: 'g', ragEnabled: 'yes' },
      { name: 'C', guidelines: 'g', ragEnabled: false },
    ]);
    expect(states.map((s) => s.ragEnabled)).toEqual([true, true, false]);
  });

  it('trims name / guidelines and drops blank-after-trim entries', () => {
    const states = buildGeneratedStates([
      { name: '  Guarded  ', guidelines: '  You wait.  ' },
      { name: '   ', guidelines: 'g' },
    ]);
    expect(states).toHaveLength(1);
    expect(states[0].name).toBe('Guarded');
    expect(states[0].guidelines).toBe('You wait.');
  });

  it('caps the number of states and keeps the set valid', () => {
    const many = Array.from({ length: MAX_GENERATED_STATES + 3 }, (_, i) => ({
      name: `State ${i}`,
      guidelines: `g${i}`,
    }));
    const states = buildGeneratedStates(many);
    expect(states).toHaveLength(MAX_GENERATED_STATES);
    expect(validateSimulationStates(states)).toEqual([]);
  });

  it('tolerates the model wrapping the list (caller unwraps; array reaches here)', () => {
    // buildGeneratedStates itself only accepts an array; the service unwraps
    // `{ states: [...] }`. Confirm a plain array of objects works.
    const states = buildGeneratedStates(goodInput);
    expect(states.length).toBeGreaterThan(0);
  });
});
