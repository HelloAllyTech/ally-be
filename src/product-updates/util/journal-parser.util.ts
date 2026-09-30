import { createHash } from 'crypto';

/**
 * The label on an entry's first line in `ally-changelog`'s CHANGELOG.md.
 *
 * Only `public` ("For release notes") was ever served by the old per-merge
 * feed. The other two exist since ally-changelog#5: `internal` for work no
 * customer can see, `needs_release_note` for an entry whose drafting call
 * failed. Product updates read all three — the label is the drafter's guess
 * about one merge seen in isolation, which is exactly the judgement this
 * module exists to make better, so it is context, not a filter.
 */
export type JournalLabel = 'public' | 'internal' | 'needs_release_note';

/** One merge to a release branch, as the journal recorded it. */
export interface JournalEntry {
  /** Stable across edits to the text: repo + merge instant (+ occurrence). */
  id: string;
  repo: string;
  /** ally-web only: which of its apps the push touched. */
  apps: string[];
  mergedAt: Date;
  label: JournalLabel;
  /** The first line's text — a draft, a raw title, or the drafter's "internal" note. */
  noteText: string;
  pr: { number: number; url: string; title: string; author: string } | null;
  /** Direct pushes list their commits; a PR entry lists none. */
  commits: { sha: string; subject: string }[];
  /** Direct pushes only. `before` can be `<sha>^` when the push had no usable before. */
  compare: { url: string; before: string; after: string } | null;
  /** Who pushed or authored, as the journal wrote it (no leading @). */
  actor: string | null;
}

const MARKER = '<!-- ENTRIES -->';

const HEADER = /^## (\S+) — ([\w.-]+)(?: \(([^)]*)\))?\s*$/;
const LABEL_LINE =
  /^- \*\*(For release notes|Internal|Needs a release note):\*\* ?(.*)$/;
const TECHNICAL_LINE = /^- \*\*Technical:\*\* (.*)$/;
// The actor is the handle alone: a hand-corrected entry can trail a note after
// it (`@ally-docs-bot[bot] _(corrected — …)_`), and that note must not become
// the author, which is a varchar(120).
const PR_TECHNICAL = /^(.*) · \[#(\d+)\]\(([^)]+)\) · @(\S+).*$/;
const PUSH_TECHNICAL =
  /^(\d+) commit\(s\)(?: · \[compare\]\(([^)]+)\))?(?: · @(\S+).*)?$/;
const COMMIT_LINE = /^\s+- (.*) \(([0-9a-f]{7,40})\)\s*$/;
const COMPARE_URL = /\/compare\/([^./]+(?:\^)?)\.\.\.([0-9a-f]{7,40})/;

const LABELS: Record<string, JournalLabel> = {
  'For release notes': 'public',
  Internal: 'internal',
  'Needs a release note': 'needs_release_note',
};

function entryId(repo: string, mergedAt: Date, occurrence: number): string {
  return createHash('sha1')
    .update(`${repo}\n${mergedAt.toISOString()}\n${occurrence}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Every entry in the journal, oldest first — the order they happened in, which
 * is the order product updates are built in.
 *
 * Tolerant in the same way the public parser is: a hand-edited block that no
 * longer parses is counted in `skipped` rather than thrown, because one bad
 * edit must not stop the whole pipeline. A block with a valid header but no
 * recognised label line is skipped too — it is not an entry the drafter wrote.
 */
export function parseJournal(markdown: string): {
  entries: JournalEntry[];
  skipped: number;
} {
  const body = markdown.includes(MARKER)
    ? markdown.slice(markdown.indexOf(MARKER) + MARKER.length)
    : markdown;

  const blocks = body.split(/\n(?=## )/);
  const entries: JournalEntry[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  for (const block of blocks) {
    const lines = block.replace(/^\s+/, '').split('\n');
    const header = HEADER.exec(lines[0] ?? '');
    if (!header) continue;

    const [, timestamp, repo, appsRaw] = header;
    const mergedAt = new Date(timestamp);
    const labelMatch = LABEL_LINE.exec(lines[1] ?? '');
    if (Number.isNaN(mergedAt.getTime()) || !labelMatch) {
      skipped += 1;
      continue;
    }

    let pr: JournalEntry['pr'] = null;
    let compare: JournalEntry['compare'] = null;
    let actor: string | null = null;
    const commits: JournalEntry['commits'] = [];

    const technical = TECHNICAL_LINE.exec(lines[2] ?? '');
    if (technical) {
      const text = technical[1];
      const prMatch = PR_TECHNICAL.exec(text);
      const pushMatch = prMatch ? null : PUSH_TECHNICAL.exec(text);
      if (prMatch) {
        pr = {
          title: prMatch[1].trim(),
          number: Number(prMatch[2]),
          url: prMatch[3],
          author: prMatch[4].trim(),
        };
        actor = pr.author;
      } else if (pushMatch) {
        actor = pushMatch[3]?.trim() || null;
        const url = pushMatch[2];
        const shas = url ? COMPARE_URL.exec(url) : null;
        if (url && shas) {
          compare = { url, before: shas[1], after: shas[2] };
        }
        for (const line of lines.slice(3)) {
          const commit = COMMIT_LINE.exec(line);
          if (commit) commits.push({ subject: commit[1], sha: commit[2] });
        }
      }
    }

    const key = `${repo}\n${mergedAt.toISOString()}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    entries.push({
      id: entryId(repo, mergedAt, occurrence),
      repo,
      apps: appsRaw
        ? appsRaw
            .split(',')
            .map((app) => app.trim())
            .filter(Boolean)
        : [],
      mergedAt,
      label: LABELS[labelMatch[1]],
      noteText: labelMatch[2].trim(),
      pr,
      commits,
      compare,
      actor,
    });
  }

  entries.sort((a, b) => a.mergedAt.getTime() - b.mergedAt.getTime());
  return { entries, skipped };
}
