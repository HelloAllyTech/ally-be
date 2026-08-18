/**
 * GAME ("Game") component types.
 *
 * A game is a short arcade break between the demanding parts of a course — a
 * roleplay, a case, a long article. It is deliberately the one component that
 * never gates anything: the learner can play it, replay it, or walk straight
 * past it, and the next component is unlocked either way (see the GAME branch
 * of `startItem`, which completes the item as soon as it is opened).
 *
 * That is a product decision, not an oversight. Bolting a score threshold onto
 * an off-the-shelf arcade game would give the course a gate that measures
 * reflexes rather than anything the learner came here to practise. Games earn
 * their place by pacing the course, so the only thing an author configures is
 * which game and an optional line of framing.
 *
 * `gameKey` selects a self-contained page under the learner app's
 * `public/games/<key>/`. The app never imports from those bundles and they
 * never import from the app; they exchange three postMessage events. Adding a
 * game means adding a key here and a folder there.
 */

export enum TrackGameKey {
  /** The Chromium offline T-Rex runner. Jump the cactus, don't die. */
  TREX_RUNNER = 'TREX_RUNNER',
  /** Tic-tac-toe against the machine. Nine squares, a minute at most. */
  TIC_TAC_TOE = 'TIC_TAC_TOE',
  /** Sixteen cards, eight pairs. Flip two at a time and remember where they were. */
  MEMORY_MATCH = 'MEMORY_MATCH',
  /** A peg-and-link puzzle. Walk the cub to the star, turning the grid to reach it. */
  CUB_N_PUP = 'CUB_N_PUP',
}

export interface GameContent {
  gameKey: TrackGameKey;
  /**
   * Optional framing shown above the game, e.g. "Shake that last call off
   * before the next roleplay." Translatable.
   */
  intro?: string;
}

/**
 * What the learner posts back after a run. Recorded as a personal best on
 * their progress row and shown back to them; it is never compared against a
 * threshold and never affects completion.
 */
export interface GameResult {
  score: number;
}
