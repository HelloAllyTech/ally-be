import { meetsMinimumScore } from '../progression.util';

describe('meetsMinimumScore', () => {
  describe('no minimum configured', () => {
    it.each([
      ['undefined (absent completionCriteria.minScore key)', undefined],
      ['null (NULL minimumScore column)', null],
    ])('passes any score when the minimum is %s', (_label, minimumScore) => {
      expect(meetsMinimumScore(80, minimumScore)).toBe(true);
      expect(meetsMinimumScore(0, minimumScore)).toBe(true);
      expect(meetsMinimumScore(-40, minimumScore)).toBe(true);
      expect(meetsMinimumScore(undefined, minimumScore)).toBe(true);
    });
  });

  describe('minimum explicitly configured as 0 (the builder default)', () => {
    // The bug: 0 was compared as a real "score >= 0" bar, so a learner whose
    // roleplay ended on a negative total score could never unlock the next
    // simulation even though the designer never set a minimum.
    it('passes a positive score', () => {
      expect(meetsMinimumScore(55, 0)).toBe(true);
    });

    it('passes a score of exactly 0', () => {
      expect(meetsMinimumScore(0, 0)).toBe(true);
    });

    it('passes a negative score — 0 means "no bar", not "score >= 0"', () => {
      expect(meetsMinimumScore(-1, 0)).toBe(true);
      expect(meetsMinimumScore(-100, 0)).toBe(true);
    });

    it('passes when the session produced no score at all', () => {
      expect(meetsMinimumScore(undefined, 0)).toBe(true);
      expect(meetsMinimumScore(null, 0)).toBe(true);
    });
  });

  describe('non-zero minimum stays enforced', () => {
    it('fails a score below the minimum', () => {
      expect(meetsMinimumScore(69, 70)).toBe(false);
      expect(meetsMinimumScore(0, 70)).toBe(false);
      expect(meetsMinimumScore(-20, 70)).toBe(false);
    });

    it('passes a score at or above the minimum', () => {
      expect(meetsMinimumScore(70, 70)).toBe(true);
      expect(meetsMinimumScore(71, 70)).toBe(true);
    });

    it('treats a missing score as 0, so a real gate is not cleared by accident', () => {
      expect(meetsMinimumScore(undefined, 70)).toBe(false);
      expect(meetsMinimumScore(null, 70)).toBe(false);
    });

    it('enforces a fractional minimum above 0', () => {
      expect(meetsMinimumScore(0, 0.5)).toBe(false);
      expect(meetsMinimumScore(1, 0.5)).toBe(true);
    });

    it('treats a negative minimum as no bar', () => {
      expect(meetsMinimumScore(-50, -10)).toBe(true);
    });
  });
});
