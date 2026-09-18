import { parseChangelog } from '../changelog-parser.util';

const PREAMBLE = `# Ally Changelog

Every entry has two lines:

- **For release notes** — an LLM-drafted, external-audience paraphrase.
- **Technical** — the raw PR or commit info.

<!-- ENTRIES -->

`;

const entry = (timestamp: string, repo: string, note: string) =>
  `## ${timestamp} — ${repo}\n- **For release notes:** ${note}\n- **Technical:** 1 commit(s) · @someone\n\n\n`;

describe('parseChangelog', () => {
  it('parses entries and returns them newest first', () => {
    const { entries, skipped } = parseChangelog(
      PREAMBLE +
        entry('2026-09-15T08:19:30Z', 'ally-be', 'Newer thing.') +
        entry('2026-09-14T07:02:08Z', 'ally-web', 'Older thing.'),
    );

    expect(skipped).toBe(0);
    expect(entries.map((e) => e.releaseNoteText)).toEqual([
      'Newer thing.',
      'Older thing.',
    ]);
    expect(entries[0].mergedAt.toISOString()).toBe('2026-09-15T08:19:30.000Z');
    expect(entries[0].repo).toBe('ally-be');
  });

  it('sorts by merge time rather than trusting the file order', () => {
    const { entries } = parseChangelog(
      PREAMBLE +
        entry('2026-09-01T00:00:00Z', 'ally-be', 'Oldest.') +
        entry('2026-09-03T00:00:00Z', 'ally-be', 'Newest.'),
    );

    expect(entries.map((e) => e.releaseNoteText)).toEqual([
      'Newest.',
      'Oldest.',
    ]);
  });

  it('keeps the changed-apps suffix out of the repo name', () => {
    const { entries } = parseChangelog(
      PREAMBLE +
        entry(
          '2026-09-15T07:32:51Z',
          'ally-web (ally-admin-dashboard, ally-helpline-dashboard)',
          'A thing.',
        ),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].repo).toBe('ally-web');
  });

  it('does not mistake the preamble prose for an entry', () => {
    const { entries } = parseChangelog(PREAMBLE);

    expect(entries).toEqual([]);
  });

  it('skips an entry whose timestamp will not parse, and counts it', () => {
    const { entries, skipped } = parseChangelog(
      PREAMBLE +
        entry('not-a-date', 'ally-be', 'Broken.') +
        entry('2026-09-15T08:19:30Z', 'ally-be', 'Fine.'),
    );

    expect(skipped).toBe(1);
    expect(entries.map((e) => e.releaseNoteText)).toEqual(['Fine.']);
  });

  it('gives an entry the same id after its text is corrected', () => {
    const before = parseChangelog(
      PREAMBLE +
        entry(
          '2026-09-15T06:28:09Z',
          'ally-ai-learn',
          'You can now listen to meditations and wellness content.',
        ),
    );
    const after = parseChangelog(
      PREAMBLE +
        entry(
          '2026-09-15T06:28:09Z',
          'ally-ai-learn',
          'Simulation characters can now speak through two more voice providers.',
        ),
    );

    expect(after.entries[0].id).toBe(before.entries[0].id);
  });

  it('separates two entries that share a repo and a timestamp', () => {
    const { entries } = parseChangelog(
      PREAMBLE +
        entry('2026-09-15T06:28:09Z', 'ally-be', 'One.') +
        entry('2026-09-15T06:28:09Z', 'ally-be', 'Two.'),
    );

    expect(entries).toHaveLength(2);
    expect(entries[0].id).not.toBe(entries[1].id);
  });
});
