/**
 * The repos whose weekly churn adds up to "what Ally shipped".
 *
 * The six that feed `ally-changelog` (so this figure and the changelog describe
 * the same population of work), plus the developer wiki, which is where a
 * decision gets written down and is real output even though it ships no code.
 *
 * `calibrate*` are deliberately absent: they are a separate product line and
 * folding them in would make a week look busier without telling the reader which
 * product got busier. Add a repo here and it appears on the axis on the next
 * request — there is nothing else to wire.
 */
export const SHIP_VOLUME_REPOS = [
  'ally-be',
  'ally-web',
  'ally-ai',
  'ally-ai-learn',
  'ally-mobile',
  'infra',
  'helloallytech.github.io',
] as const;

/** Windows the client may ask for, in weeks. */
export const SHIP_VOLUME_WINDOWS = [12, 26, 52] as const;

export const SHIP_VOLUME_DEFAULT_WEEKS = 12;

/**
 * How long a repo's last good statistics response is kept.
 *
 * Generous on purpose. This cache is not there to save requests — seven calls is
 * nothing — it is there so that GitHub answering 202 (which it does whenever its
 * own statistics cache has been invalidated by a push, i.e. exactly when someone
 * is most likely to be looking) degrades to "this slice is a few hours behind"
 * instead of "this repo is missing from every bar".
 */
export const SHIP_VOLUME_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Redis key for one repo's cached weekly series. */
export const shipVolumeCacheKey = (repo: string): string =>
  `analytics:ship-volume:code-frequency:${repo}`;
