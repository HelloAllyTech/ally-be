/**
 * The vote budget's calendar month, as 'YYYY-MM'.
 *
 * ALWAYS UTC, and always computed server-side. The standalone app derived this in the browser
 * from local getMonth(), which had two consequences: a tab left open across midnight on the
 * 1st wrote votes into the previous month, and a user in IST disagreed with a UTC server about
 * which month they were voting in. Fixing it means one authority (this function) and a wire
 * contract where the client never sends a period key — it receives one.
 *
 * The clock is injectable so the month-boundary tests are deterministic rather than
 * "run it in December".
 */
export function currentPeriodKey(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // getUTCMonth is 0-based
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Matches CHK_roadmap_allocations_period. Rejects '2026-13', '2026-0', '26-01'. */
const PERIOD_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidPeriodKey(value: string): boolean {
  return PERIOD_KEY_PATTERN.test(value);
}

/**
 * The daily vote grant's day key, as 'YYYY-MM-DD' — same UTC-only, server-computed rule as
 * currentPeriodKey(), and for the same reason: a client-derived key would let a tab open across
 * midnight, or a user outside UTC, land a grant in the wrong day and double up (or miss) one.
 * Used as the idempotency key in RoadmapVoteGrantRepository.grantDaily().
 */
export function currentDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
