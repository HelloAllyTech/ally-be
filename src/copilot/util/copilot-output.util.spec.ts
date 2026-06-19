import {
  computeCompositeScore,
  parseCopilotBaseOutput,
} from './copilot-output.util';

describe('copilot-output.util', () => {
  describe('parseCopilotBaseOutput', () => {
    it('parses direct JSON', () => {
      const out = parseCopilotBaseOutput('{"title":"A","roleInstruction":"B"}');
      expect(out).toEqual({ title: 'A', roleInstruction: 'B' });
    });

    it('parses fenced JSON', () => {
      const out = parseCopilotBaseOutput('```json\n{"title":"A"}\n```');
      expect(out).toEqual({ title: 'A' });
    });

    it('rescues the outermost object from surrounding prose', () => {
      const out = parseCopilotBaseOutput(
        'Here you go:\n{"title":"A"}\nThanks!',
      );
      expect(out).toEqual({ title: 'A' });
    });

    it('returns null for empty / non-object / unparseable input', () => {
      expect(parseCopilotBaseOutput('')).toBeNull();
      expect(parseCopilotBaseOutput(null)).toBeNull();
      expect(parseCopilotBaseOutput('not json')).toBeNull();
      expect(parseCopilotBaseOutput('[1,2,3]')).toBeNull();
    });
  });

  describe('computeCompositeScore', () => {
    it('returns the rounded mean of the metric values', () => {
      expect(computeCompositeScore({ a: 80, b: 70, c: 60 })).toBe(70);
      // 71.66.. -> 72
      expect(computeCompositeScore({ a: 75, b: 70, c: 70 })).toBe(72);
    });

    it('ignores non-finite values and returns null when empty', () => {
      expect(
        computeCompositeScore({ a: 80, b: NaN as unknown as number }),
      ).toBe(80);
      expect(computeCompositeScore({})).toBeNull();
      expect(computeCompositeScore(null)).toBeNull();
      expect(computeCompositeScore(undefined)).toBeNull();
    });
  });
});
