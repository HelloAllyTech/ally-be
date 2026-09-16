export enum ScenarioVersionType {
  // Created explicitly by an author: New version, branch/fork, or revert.
  MANUAL = 'MANUAL',
  // Created by the daily auto-version job from a modified draft.
  AUTOMATIC = 'AUTOMATIC',
}
