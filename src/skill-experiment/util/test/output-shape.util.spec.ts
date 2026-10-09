import { conformsToShape, inferOutputShape } from '../output-shape.util';

describe('inferOutputShape', () => {
  it('learns the keys every JSON output shared', () => {
    expect(
      inferOutputShape([
        '{"score": 3, "feedback": "a", "criteriaScores": []}',
        '```json\n{"score": 4, "feedback": "b"}\n```',
      ]),
    ).toEqual({ kind: 'json', requiredKeys: ['feedback', 'score'] });
  });

  it('treats a mostly-prose skill as text', () => {
    expect(inferOutputShape(['Great work.', 'Try again.', '{"a": 1}'])).toEqual(
      { kind: 'text' },
    );
  });

  it('treats no outputs as text', () => {
    expect(inferOutputShape([])).toEqual({ kind: 'text' });
  });
});

describe('conformsToShape', () => {
  const shape = { kind: 'json' as const, requiredKeys: ['feedback', 'score'] };

  it('accepts an output with the required keys', () => {
    expect(
      conformsToShape('{"score": 1, "feedback": "x", "extra": 1}', shape),
    ).toBe(true);
  });

  it('rejects an output missing a key the call site reads', () => {
    expect(conformsToShape('{"score": 1}', shape)).toBe(false);
  });

  it('rejects prose where JSON was established', () => {
    expect(conformsToShape('Score: 1', shape)).toBe(false);
  });

  it('rejects an empty output whatever the shape', () => {
    expect(conformsToShape('  ', null)).toBe(false);
    expect(conformsToShape('ok', { kind: 'text' })).toBe(true);
  });
});
