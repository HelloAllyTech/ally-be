import { SHIP_VOLUME_REPOS } from 'src/analytics/constants/ship-volume.constants';

/**
 * The repos whose daily churn the public changelog's heatmap sums.
 *
 * The same population as the admin ship-volume chart, on purpose: the two are
 * the same measure at two grains (a week there, a day here), and a figure that
 * silently covered a different set of repos would disagree with it for no
 * reason a reader could see. Add a repo there and it appears here too.
 */
export const CODE_ACTIVITY_REPOS = SHIP_VOLUME_REPOS;

/**
 * The first day any of those repos has a commit (`ally-mobile`, 2025-04-23).
 * The heatmap stops loading older days here rather than paging on through
 * empty months to the epoch.
 */
export const CODE_ACTIVITY_EARLIEST_DATE = '2025-04-23';

export const CODE_ACTIVITY_DEFAULT_DAYS = 30;

/** Enough for a quarter per request; a window touches at most 4 months. */
export const CODE_ACTIVITY_MAX_DAYS = 92;

/** How often the month in progress is re-read from GitHub. */
export const CODE_ACTIVITY_CURRENT_MONTH_REFRESH_MS = 10 * 60 * 1000;

/** How often a recently closed month is re-read (see SETTLE below). */
export const CODE_ACTIVITY_CLOSED_MONTH_REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * How long after a month ends before its numbers are treated as final.
 *
 * Days are bucketed by commit date, and a PR landed with a merge commit keeps
 * its branch commits' original dates — so a branch merged on the 5th adds lines
 * to days in the previous month. Past this point a month is read once more and
 * then never again.
 */
export const CODE_ACTIVITY_SETTLE_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Safety cap on history pages per repo-month (100 commits each). Busy months
 * run to ~6 pages; hitting the cap means something is wrong, and the month is
 * refused rather than cached truncated.
 */
export const CODE_ACTIVITY_MAX_PAGES_PER_MONTH = 100;

/** Redis key for one repo's daily totals for one UTC month (`yyyy-mm`). */
export const codeActivityCacheKey = (repo: string, month: string): string =>
  `changelog:code-activity:v1:${repo}:${month}`;
