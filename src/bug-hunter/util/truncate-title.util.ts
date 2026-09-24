/**
 * Shortens a finding's title to `maxLength`, breaking at the nearest sentence
 * or word boundary rather than a raw character cut. A blind `.slice(0, 200)`
 * (this function's only two call sites, both in bug-finding.service.ts, used
 * to do exactly that) chops mid-word — "...which can result in a degraded u"
 * — because most finder descriptions run well past 200 characters before
 * their first natural break.
 */
export function truncateTitle(text: string, maxLength = 200): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const window = trimmed.slice(0, maxLength);
  const sentenceBoundary = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
    window.lastIndexOf('\n'),
  );
  // Only honour a sentence boundary in the back half of the window —
  // otherwise a single long opening sentence would cut the title down to
  // almost nothing.
  if (sentenceBoundary > maxLength * 0.5) {
    return window.slice(0, sentenceBoundary + 1).trim();
  }

  const wordBoundary = window.lastIndexOf(' ');
  const safe = wordBoundary > 0 ? window.slice(0, wordBoundary) : window;
  return `${safe.trim()}…`;
}
