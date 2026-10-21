import {
  autonomyLevelOf,
  nextAutonomyLevel,
  switchesForAutonomyLevel,
} from '../builder-autonomy.util';

describe('builder autonomy levels', () => {
  it('round-trips every level through its switches', () => {
    for (const level of ['off', 'assist', 'auto_merge', 'auto'] as const) {
      expect(autonomyLevelOf(switchesForAutonomyLevel(level))).toBe(level);
    }
  });

  it('assist reviews, fixes and approves, but never merges or releases', () => {
    expect(switchesForAutonomyLevel('assist')).toEqual({
      autoReviewEnabled: true,
      autoFixEnabled: true,
      autoApproveEnabled: true,
      autoMergeEnabled: false,
      autoReleaseEnabled: false,
    });
  });

  it('reads a mix that matches no level as custom', () => {
    expect(
      autonomyLevelOf({
        ...switchesForAutonomyLevel('assist'),
        autoReleaseEnabled: true,
      }),
    ).toBe('custom');
  });

  it('suggests one level up, and nothing past auto or from custom', () => {
    expect(nextAutonomyLevel('assist')).toBe('auto_merge');
    expect(nextAutonomyLevel('auto_merge')).toBe('auto');
    expect(nextAutonomyLevel('auto')).toBeNull();
    expect(nextAutonomyLevel('custom')).toBeNull();
  });
});
