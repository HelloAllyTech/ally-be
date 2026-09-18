import {
  DAILY_SOURCE_CAPS,
  DAILY_XP_CEILING,
  depthMilestonesCrossed,
  isEngagedSession,
  LEVEL_THRESHOLDS,
  MAX_LEVEL,
  MIN_LEARNER_TURNS_FOR_XP,
  MIN_SESSION_SECONDS_FOR_XP,
  PER_SESSION_MINUTE_CEILING,
  practiceXpForSession,
  resolveLevel,
  TRACK_ITEM_XP,
  trackItemXp,
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
    /** Enough turns that the engagement gate is never what fails a case below. */
    const engagedTurns = (seconds: number) =>
      Math.max(MIN_LEARNER_TURNS_FOR_XP, Math.ceil(seconds / 60));

    it('awards nothing at all for a session below the minimum duration', () => {
      const seconds = MIN_SESSION_SECONDS_FOR_XP - 1;
      expect(practiceXpForSession(seconds, engagedTurns(seconds))).toEqual({
        minuteXp: 0,
        completionXp: 0,
      });
    });

    it('rounds minutes down so a partial minute cannot be farmed', () => {
      const result = practiceXpForSession(119, engagedTurns(119));
      expect(result.minuteXp).toBe(1 * XP_AWARD.PER_PRACTICE_MINUTE);
    });

    it('adds the completion bonus once the session qualifies', () => {
      const result = practiceXpForSession(600, engagedTurns(600));
      expect(result.completionXp).toBe(XP_AWARD.PER_SESSION_COMPLETED);
    });

    it('withholds everything from a session the learner was not present in', () => {
      // Long enough to qualify on duration, but nobody spoke.
      expect(practiceXpForSession(600, 0)).toEqual({
        minuteXp: 0,
        completionXp: 0,
      });
    });

    it('caps the minutes one session can bank', () => {
      const seconds = 6 * 60 * 60;
      const result = practiceXpForSession(seconds, engagedTurns(seconds));
      expect(result.minuteXp).toBe(PER_SESSION_MINUTE_CEILING);
    });
  });

  describe('isEngagedSession', () => {
    it('rejects a session with no turns', () => {
      expect(isEngagedSession(600, 0)).toBe(false);
    });

    it('rejects a session below the turn floor however long it ran', () => {
      expect(isEngagedSession(3600, MIN_LEARNER_TURNS_FOR_XP - 1)).toBe(false);
    });

    it('rejects a handful of turns spread over an idle hour', () => {
      expect(isEngagedSession(3600, 5)).toBe(false);
    });

    it('accepts a short conversation with real back-and-forth', () => {
      expect(isEngagedSession(120, 8)).toBe(true);
    });

    it('rejects a non-finite duration rather than dividing by it', () => {
      expect(isEngagedSession(Number.NaN, 100)).toBe(false);
      expect(isEngagedSession(0, 100)).toBe(false);
    });
  });

  describe('trackItemXp', () => {
    it('pays nothing for a roleplay item, whose session already paid', () => {
      expect(trackItemXp('ROLEPLAY')).toBe(0);
    });

    it('pays graded work more than passive consumption', () => {
      expect(trackItemXp('QUIZ')).toBeGreaterThan(trackItemXp('VIDEO'));
      expect(trackItemXp('ANNOTATED_ARTIFACT')).toBeGreaterThan(
        trackItemXp('ARTICLE'),
      );
    });

    it('pays nothing for an unknown type rather than guessing', () => {
      expect(trackItemXp('NOT_A_TYPE')).toBe(0);
      expect(trackItemXp(undefined)).toBe(0);
    });

    it('has a weight for every component type', () => {
      Object.values(TRACK_ITEM_XP).forEach((xp) => {
        expect(Number.isInteger(xp)).toBe(true);
        expect(xp).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('depthMilestonesCrossed', () => {
    it('returns the milestones a day newly crossed', () => {
      expect(depthMilestonesCrossed(0, 40).map((m) => m.minutes)).toEqual([
        15, 30,
      ]);
    });

    it('does not re-report a milestone already behind us', () => {
      expect(depthMilestonesCrossed(20, 35).map((m) => m.minutes)).toEqual([
        30,
      ]);
    });

    it('returns nothing when the day crossed none', () => {
      expect(depthMilestonesCrossed(31, 45)).toEqual([]);
    });
  });

  describe('daily caps', () => {
    it('sums to more than the ceiling, so no learner can bank every source', () => {
      const sum = DAILY_SOURCE_CAPS.reduce((total, s) => total + s.cap, 0);
      expect(sum).toBeGreaterThan(DAILY_XP_CEILING);
    });

    it('gives every capped source a positive cap below the ceiling', () => {
      DAILY_SOURCE_CAPS.forEach((source) => {
        expect(source.cap).toBeGreaterThan(0);
        expect(source.cap).toBeLessThanOrEqual(DAILY_XP_CEILING);
        expect(source.rules.length).toBeGreaterThan(0);
      });
    });

    it('never puts one rule under two caps', () => {
      const rules = DAILY_SOURCE_CAPS.flatMap((s) => s.rules);
      expect(new Set(rules).size).toBe(rules.length);
    });
  });
});
