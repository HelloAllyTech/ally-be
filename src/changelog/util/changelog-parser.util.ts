import { createHash } from 'crypto';

/** One entry as it appears in `ally-changelog`'s CHANGELOG.md. */
export interface ParsedChangelogEntry {
  /** Stable across edits to the text — see `entryId`. */
  id: string;
  repo: string;
  releaseNoteText: string;
  mergedAt: Date;
}

/**
 * Matches one entry's first two lines:
 *
 * ```
 * ## 2026-09-15T08:19:30Z — ally-web (ally-admin-dashboard)
 * - **For release notes:** The settings panel now saves your preferences.
 * ```
 *
 * The same shape `ally-changelog`'s own `backfill_entries.py` has parsed since
 * the feed existed, deliberately kept identical so the two cannot drift: the
 * "Technical" line below it is for engineers reading the file and is not part
 * of the public feed. The separator is an em dash (U+2014), written by
 * `append_entry.py`'s `format_entry`.
 *
 * The preamble at the top of CHANGELOG.md documents this format in prose
 * ("- **For release notes** — an LLM-drafted..."), which does not match:
 * that line has no colon inside the bold span and no `##` header above it.
 */
const ENTRY_PATTERN =
  /^## (\S+) — ([\w.-]+)(?: \([^)]*\))?\n- \*\*For release notes:\*\* (.+)$/gm;

/**
 * A changelog entry has no natural key of its own, so one is derived from what
 * identifies it: the repo and the instant it merged. Deliberately NOT a hash of
 * the note text — correcting a badly-drafted line should not look like a
 * different entry to a client keying on this.
 *
 * `occurrence` disambiguates the pathological case of two entries for one repo
 * sharing a timestamp to the second.
 */
function entryId(repo: string, mergedAt: Date, occurrence: number): string {
  return createHash('sha1')
    .update(`${repo}\n${mergedAt.toISOString()}\n${occurrence}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Parses CHANGELOG.md into the entries the public feed serves, newest first.
 *
 * Skips anything malformed rather than throwing — a single hand-edited entry
 * must not be able to take down a public page, and the count of what was
 * skipped is returned so the caller can log it.
 */
export function parseChangelog(markdown: string): {
  entries: ParsedChangelogEntry[];
  skipped: number;
} {
  const entries: ParsedChangelogEntry[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  for (const match of markdown.matchAll(ENTRY_PATTERN)) {
    const [, timestamp, repo, releaseNoteText] = match;
    const mergedAt = new Date(timestamp);
    if (Number.isNaN(mergedAt.getTime())) {
      skipped += 1;
      continue;
    }
    const key = `${repo}\n${mergedAt.toISOString()}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    entries.push({
      id: entryId(repo, mergedAt, occurrence),
      repo,
      releaseNoteText: releaseNoteText.trim(),
      mergedAt,
    });
  }

  // The file is written newest-first, but the feed's contract is the ordering,
  // not the file's — sort rather than inherit it, the same way the SQL this
  // replaced ordered by mergedAt DESC.
  entries.sort((a, b) => b.mergedAt.getTime() - a.mergedAt.getTime());

  return { entries, skipped };
}
