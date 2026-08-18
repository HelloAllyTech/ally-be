import { RoadmapOpportunityStage } from '../enum/roadmap-opportunity.enum';

/**
 * Month-board arithmetic. Pure functions, no repository — the same rules are needed by the
 * board's drag handler, by the drawer's "planned month" edit, and by the SQL that groups rows
 * into lanes, and three copies of "which month does this card live in" is exactly how a board
 * starts disagreeing with itself.
 *
 * Month keys are 'YYYY-MM', the same shape and the same UTC basis as the coin period key
 * (see roadmap-period.util.ts). Reusing that shape is deliberate: it sorts lexicographically,
 * so a month window is a plain BETWEEN in SQL with no date casting.
 */

/** Matches CHK_roadmap_opps_planned_month. Rejects '2026-13', '2026-0', '26-01'. */
const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonthKey(value: string): boolean {
  return MONTH_KEY_PATTERN.test(value);
}

/** 'YYYY-MM' for a date, always UTC — see currentPeriodKey for why this is never local time. */
export function monthKeyOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1; // getUTCMonth is 0-based
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Step a month key by whole months. Date.UTC normalises overflow both ways, so
 * shiftMonthKey('2026-12', 1) === '2027-01' and shiftMonthKey('2026-01', -1) === '2025-12'
 * without any special-casing of year boundaries.
 */
export function shiftMonthKey(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  return monthKeyOf(new Date(Date.UTC(year, month - 1 + delta, 1)));
}

/** Inclusive list of month keys from `from` to `to`. Empty when the range is inverted. */
export function monthKeyRange(from: string, to: string): string[] {
  const keys: string[] = [];
  let cursor = from;
  // Bounded by the caller's validated window; the guard is against a malformed key
  // producing an unbounded loop rather than against a large legitimate range.
  while (cursor <= to && keys.length < 120) {
    keys.push(cursor);
    cursor = shiftMonthKey(cursor, 1);
  }
  return keys;
}

/**
 * Whether a card's month is decided FOR it rather than by whoever drags it.
 *
 * Once something has shipped, the month it shipped in is a fact, so the board shows it there and
 * refuses to move it. A released row with a NULL releasedAt is NOT pinned — roughly 173 of the 280
 * rows migrated from the standalone app are exactly that (the source trigger only fired on
 * transition, and nothing may backfill it), and pinning those would strand them in a lane that
 * cannot exist while also making them undraggable.
 */
export function isMonthPinned(
  stage: RoadmapOpportunityStage,
  releasedAt: Date | null | undefined,
): boolean {
  return stage === RoadmapOpportunityStage.RELEASED && !!releasedAt;
}

/**
 * The lane a card actually appears in: its release month once it has shipped, otherwise the
 * month somebody planned it into. Null means the Unscheduled lane.
 *
 * Mirrored in SQL by EFFECTIVE_MONTH_SQL in RoadmapOpportunityRepository — change both together.
 */
export function effectiveMonthOf(
  stage: RoadmapOpportunityStage,
  releasedAt: Date | null | undefined,
  plannedMonth: string | null | undefined,
): string | null {
  if (isMonthPinned(stage, releasedAt))
    return monthKeyOf(new Date(releasedAt!));
  return plannedMonth ?? null;
}
