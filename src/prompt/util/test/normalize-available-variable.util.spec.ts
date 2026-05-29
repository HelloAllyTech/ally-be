import {
  getAvailableVariableName,
  normalizeAvailableVariables,
  reconcileAvailableVariables,
} from '../normalize-available-variable.util';

describe('getAvailableVariableName', () => {
  it('returns the string itself for legacy bare-name entries', () => {
    expect(getAvailableVariableName('name')).toBe('name');
  });

  it('returns the `name` field for rich object entries', () => {
    expect(getAvailableVariableName({ name: 'tone', label: 'Tone' })).toBe(
      'tone',
    );
  });

  it('falls back to empty string for malformed entries', () => {
    expect(getAvailableVariableName({} as never)).toBe('');
  });
});

describe('normalizeAvailableVariables', () => {
  it('returns [] for undefined / null input', () => {
    expect(normalizeAvailableVariables(undefined)).toEqual([]);
    expect(normalizeAvailableVariables(null)).toEqual([]);
  });

  it('promotes bare strings to `{ name }` objects', () => {
    expect(normalizeAvailableVariables(['age', 'name'])).toEqual([
      { name: 'age' },
      { name: 'name' },
    ]);
  });

  it('preserves label and required on object entries', () => {
    expect(
      normalizeAvailableVariables([
        { name: 'name', label: 'Name', required: true },
      ]),
    ).toEqual([{ name: 'name', label: 'Name', required: true }]);
  });

  it('dedupes by name; per-field "first non-undefined wins" merge', () => {
    // First entry has label but no required; later entry fills in required
    // without clobbering the existing label. This lets a meta JSON layer
    // metadata onto an entry that auto-parse already discovered as a bare
    // name from prompt text.
    const result = normalizeAvailableVariables([
      { name: 'tone', label: 'Tone' },
      { name: 'tone', label: 'Tone (override)', required: true },
      'tone',
    ]);
    expect(result).toEqual([{ name: 'tone', label: 'Tone', required: true }]);
  });

  it('drops empty / malformed entries', () => {
    const result = normalizeAvailableVariables([
      '   ',
      { name: '' } as never,
      { label: 'orphan' } as never,
      'age',
    ]);
    expect(result).toEqual([{ name: 'age' }]);
  });
});

describe('reconcileAvailableVariables (the "fields removed via prompt management" path)', () => {
  it('keeps metadata for variables still referenced by the new text', () => {
    const existing = [
      { name: 'name', label: 'Name', required: true },
      { name: 'tone', label: 'Tone' },
    ];
    const parsed = ['name', 'tone'];
    expect(reconcileAvailableVariables(existing, parsed)).toEqual([
      { name: 'name', label: 'Name', required: true },
      { name: 'tone', label: 'Tone' },
    ]);
  });

  it('drops variables no longer referenced by the new text', () => {
    const existing = [
      { name: 'name', label: 'Name' },
      { name: 'tone', label: 'Tone' },
    ];
    // Author removed `{tone}` from the prompt text and saved.
    const parsed = ['name'];
    expect(reconcileAvailableVariables(existing, parsed)).toEqual([
      { name: 'name', label: 'Name' },
    ]);
  });

  it('appends new placeholders typed in the text as bare entries', () => {
    const existing = [{ name: 'name', label: 'Name' }];
    // Author added `{competency}` to the prompt text and saved.
    const parsed = ['competency', 'name'];
    expect(reconcileAvailableVariables(existing, parsed)).toEqual([
      { name: 'competency' },
      { name: 'name', label: 'Name' },
    ]);
  });

  it('handles a complete swap (all removed + all new)', () => {
    const existing = [
      { name: 'name', label: 'Name' },
      { name: 'age', label: 'Age', required: true },
    ];
    const parsed = ['title', 'description'];
    expect(reconcileAvailableVariables(existing, parsed)).toEqual([
      { name: 'description' },
      { name: 'title' },
    ]);
  });

  it('handles legacy string[] existing data', () => {
    const existing = ['name', 'tone'];
    const parsed = ['name'];
    expect(reconcileAvailableVariables(existing, parsed)).toEqual([
      { name: 'name' },
    ]);
  });

  it('returns [] when the prompt no longer references any placeholders', () => {
    expect(
      reconcileAvailableVariables([{ name: 'name', label: 'Name' }], []),
    ).toEqual([]);
  });
});
