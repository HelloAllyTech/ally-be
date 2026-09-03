import {
  DAILY_PRACTICE_XP_CAP,
  LEVEL_THRESHOLDS,
  MAX_LEVEL,
  MIN_SESSION_SECONDS_FOR_XP,
  practiceXpForSession,
  resolveLevel,
  STREAK_MULTIPLIER_MIN_DAYS,
  XP_AWARD,
} from './progress.constants';

describe('progress constants', () => {
  describe('LEVEL_THRESHOLDS', () => {
    it('has one threshold per level', () => {
      expect(LEVEL_THRESHOLDS).toHaveLength(MAX_LEVEL);
    });

    it('increases strictly, with each level costing more than the last', () => {
      for (let i = 1; i < LEVEL_THRESHOLDS.length; i += 1) {
        expect(LEVEL_THRESHOLDS[i]).toBeGreaterThan(LEVEL_THRESHOLDS[i - 1]);
        if (i >= 2) {
          const thisDelta = LEVEL_THRESHOLDS[i] - LEVEL_THRESHOLDS[i - 1];
          const prevDelta = LEVEL_THRESHOLDS[i - 1] - LEVEL_THRESHOLDS[i - 2];
          expect(thisDelta).toBeGreaterThan(prevDelta);
        }
      }
    });

    it('does not top out before the 5,000 minute certification bar', () => {
      // A learner at the L1 Certification bar earns at least 5,000 practice XP, and
      // should still have ladder left to climb.
      expect(LEVEL_THRESHOLDS[MAX_LEVEL - 1]).toBeGreaterThan(5000);
    });
  });

  describe('resolveLevel', () => {
    it('starts a learner with no XP at level 1', () => {
      const standing = resolveLevel(0);
      expect(standing.level).toBe(1);
      expect(standing.xpIntoLevel).toBe(0);
      expect(standing.xpToNextLevel).toBe(100);
      expect(standing.isMaxLevel).toBe(false);
    });

    it('treats a negative or non-finite total as zero rather than a negative level', () => {
      expect(resolveLevel(-500).level).toBe(1);
      expect(resolveLevel(Number.NaN).level).toBe(1);
    });

    it('levels up exactly at the threshold, not one XP later', () => {
      expect(resolveLevel(99).level).toBe(1);
      expect(resolveLevel(100).level).toBe(2);
      expect(resolveLevel(259).level).toBe(2);
      expect(resolveLevel(260).level).toBe(3);
    });

    it('reports position inside the current level', () => {
      const standing = resolveLevel(180);
      expect(standing.level).toBe(2);
      expect(standing.levelFloorXp).toBe(100);
      expect(standing.nextLevelXp).toBe(260);
      expect(standing.xpIntoLevel).toBe(80);
      expect(standing.xpToNextLevel).toBe(80);
      expect(standing.progress).toBeCloseTo(0.5);
    });

    it('caps at max level with a full bar and no next threshold', () => {
      const standing = resolveLevel(LEVEL_THRESHOLDS[MAX_LEVEL - 1] + 50_000);
      expect(standing.level).toBe(MAX_LEVEL);
      expect(standing.isMaxLevel).toBe(true);
      expect(standing.nextLevelXp).toBeNull();
      expect(standing.xpToNextLevel).toBeNull();
      expect(standing.progress).toBe(1);
    });
  });

  describe('practiceXpForSession', () => {
    it('awards nothing at all for a session below the minimum duration', () => {
      const result = practiceXpForSession(MIN_SESSION_SECONDS_FOR_XP - 1, 10);
      expect(result).toEqual({
        minuteXp: 0,
        streakBonusXp: 0,
        completionXp: 0,
      });
    });

    it('rounds minutes down so a partial minute cannot be farmed', () => {
      const result = practiceXpForSession(119, 0);
      expect(result.minuteXp).toBe(1 * XP_AWARD.PER_PRACTICE_MINUTE);
    });

    it('adds the completion bonus once the session qualifies', () => {
      const result = practiceXpForSession(600, 0);
      expect(result.completionXp).toBe(XP_AWARD.PER_SESSION_COMPLETED);
    });

    it('withholds the streak bonus below the streak threshold', () => {
      const result = practiceXpForSession(600, STREAK_MULTIPLIER_MIN_DAYS - 1);
      expect(result.streakBonusXp).toBe(0);
    });

    it('applies the streak bonus from the threshold day onward', () => {
      const result = practiceXpForSession(600, STREAK_MULTIPLIER_MIN_DAYS);
      // 10 minutes = 10 XP, +25% = 2.5 -> 3
      expect(result.minuteXp).toBe(10);
      expect(result.streakBonusXp).toBe(3);
    });

    it('can outrun the daily practice cap, so the cap is what bounds a long session', () => {
      // Six hours is far beyond any real roleplay. This function deliberately does not
      // apply the cap itself — it reports the raw award and the service clamps it — so
      // the guard only works if the raw number can exceed the cap.
      const result = practiceXpForSession(6 * 60 * 60, 30);
      const practiceTotal = result.minuteXp + result.streakBonusXp;
      expect(practiceTotal).toBeGreaterThan(DAILY_PRACTICE_XP_CAP);
    });
  });
});
