/**
 * How much Builder does on its own, as one level rather than five switches.
 *
 * Stacks, "Design autonomy sliders to build user trust": expose autonomy as a
 * few clearly labelled levels with predictable behaviour at each, and make
 * moving between them one step. The switches stay underneath (and stay
 * settable on their own, which reads back as `custom`).
 */
export type BuilderAutonomyLevel = 'off' | 'assist' | 'auto_merge' | 'auto';
export const BUILDER_AUTONOMY_LEVELS: BuilderAutonomyLevel[] = [
  'off',
  'assist',
  'auto_merge',
  'auto',
];

interface AutonomySwitches {
  autoReviewEnabled: boolean;
  autoFixEnabled: boolean;
  autoApproveEnabled: boolean;
  autoMergeEnabled: boolean;
  autoReleaseEnabled: boolean;
}

const LEVELS: Record<BuilderAutonomyLevel, AutonomySwitches> = {
  off: {
    autoReviewEnabled: false,
    autoFixEnabled: false,
    autoApproveEnabled: false,
    autoMergeEnabled: false,
    autoReleaseEnabled: false,
  },
  assist: {
    autoReviewEnabled: true,
    autoFixEnabled: true,
    autoApproveEnabled: true,
    autoMergeEnabled: false,
    autoReleaseEnabled: false,
  },
  auto_merge: {
    autoReviewEnabled: true,
    autoFixEnabled: true,
    autoApproveEnabled: true,
    autoMergeEnabled: true,
    autoReleaseEnabled: false,
  },
  auto: {
    autoReviewEnabled: true,
    autoFixEnabled: true,
    autoApproveEnabled: true,
    autoMergeEnabled: true,
    autoReleaseEnabled: true,
  },
};

export const switchesForAutonomyLevel = (
  level: BuilderAutonomyLevel,
): AutonomySwitches => ({ ...LEVELS[level] });

export const autonomyLevelOf = (
  settings: AutonomySwitches,
): BuilderAutonomyLevel | 'custom' =>
  BUILDER_AUTONOMY_LEVELS.find((level) =>
    (Object.keys(LEVELS[level]) as (keyof AutonomySwitches)[]).every(
      (key) => Boolean(settings[key]) === LEVELS[level][key],
    ),
  ) ?? 'custom';

/** The level after this one, for suggesting it once it has been earned. */
export const nextAutonomyLevel = (
  level: BuilderAutonomyLevel | 'custom',
): 'auto_merge' | 'auto' | null =>
  level === 'assist' ? 'auto_merge' : level === 'auto_merge' ? 'auto' : null;
