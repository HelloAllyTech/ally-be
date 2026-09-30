import { parseJournal } from '../journal-parser.util';

const PREAMBLE = `# Ally Changelog

Every entry has two lines. The first line's label decides whether the public page shows it:

- **For release notes** — an LLM-drafted, external-audience paraphrase.
- **Internal** — work no customer can see.
- **Technical** — the raw PR or commit info.

---

<!-- ENTRIES -->

`;

const prEntry = (
  timestamp: string,
  header: string,
  label: string,
  note: string,
  title: string,
  number: number,
) =>
  `## ${timestamp} — ${header}\n- **${label}:** ${note}\n- **Technical:** ${title} · [#${number}](https://github.com/HelloAllyTech/ally-web/pull/${number}) · @sandeepmalhotra-ally\n\n\n`;

const pushEntry = (
  timestamp: string,
  repo: string,
  label: string,
  note: string,
  commits: [string, string][],
) =>
  `## ${timestamp} — ${repo}\n- **${label}:** ${note}\n- **Technical:** ${commits.length} commit(s) · [compare](https://github.com/HelloAllyTech/${repo}/compare/55b46b5b8673a700afe6cf0f5bb1351ba0cbac3f...af7c20a10322f827816fdeb5a8b0c7c79033e681) · @gksoriginals\n${commits
    .map(([subject, sha]) => `  - ${subject} (${sha})`)
    .join('\n')}\n\n\n`;

describe('parseJournal', () => {
  it('reads a PR entry with its apps, label and PR reference', () => {
    const { entries, skipped } = parseJournal(
      PREAMBLE +
        prEntry(
          '2026-09-30T08:42:51Z',
          'ally-web (ally-admin-dashboard, ally-helpline-dashboard)',
          'For release notes',
          'Admins can see a thing.',
          'feat(admin-analytics): XP per Roleplay Minute chart (AAQ-165)',
          734,
        ),
    );

    expect(skipped).toBe(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      repo: 'ally-web',
      apps: ['ally-admin-dashboard', 'ally-helpline-dashboard'],
      label: 'public',
      noteText: 'Admins can see a thing.',
      pr: {
        number: 734,
        title: 'feat(admin-analytics): XP per Roleplay Minute chart (AAQ-165)',
        url: 'https://github.com/HelloAllyTech/ally-web/pull/734',
        author: 'sandeepmalhotra-ally',
      },
      commits: [],
      compare: null,
      actor: 'sandeepmalhotra-ally',
    });
    expect(entries[0].mergedAt.toISOString()).toBe('2026-09-30T08:42:51.000Z');
  });

  it('reads a direct push with every commit and the compare range', () => {
    const { entries } = parseJournal(
      PREAMBLE +
        pushEntry('2026-09-30T08:52:44Z', 'ally-ai-learn', 'Internal', 'x', [
          ['fix(openers): no long silences', '9d83a4c'],
          ['test(tts): expect inactivity_timeout', '24f1476'],
        ]),
    );

    expect(entries[0].pr).toBeNull();
    expect(entries[0].label).toBe('internal');
    expect(entries[0].commits).toEqual([
      { subject: 'fix(openers): no long silences', sha: '9d83a4c' },
      { subject: 'test(tts): expect inactivity_timeout', sha: '24f1476' },
    ]);
    expect(entries[0].compare).toEqual({
      url: 'https://github.com/HelloAllyTech/ally-ai-learn/compare/55b46b5b8673a700afe6cf0f5bb1351ba0cbac3f...af7c20a10322f827816fdeb5a8b0c7c79033e681',
      before: '55b46b5b8673a700afe6cf0f5bb1351ba0cbac3f',
      after: 'af7c20a10322f827816fdeb5a8b0c7c79033e681',
    });
    expect(entries[0].actor).toBe('gksoriginals');
  });

  it('keeps only the handle when a corrected entry trails a note after it', () => {
    const { entries, skipped } = parseJournal(
      PREAMBLE +
        `## 2026-08-14T05:02:57Z — ally-ai-learn\n- **Internal:** Internal change with no visible impact.\n- **Technical:** chore: sync wiki routing index · [#142](https://github.com/HelloAllyTech/ally-ai-learn/pull/142) · @ally-docs-bot[bot] _(corrected — the original entry hit a since-fixed bug where a transient PR-lookup failure produced a blank technical line)_\n\n\n` +
        `## 2026-08-13T05:02:57Z — ally-be\n- **Internal:** x\n- **Technical:** 1 commit(s) · @gksoriginals _(corrected)_\n  - fix: a (aaaaaaa)\n\n\n`,
    );

    expect(skipped).toBe(0);
    expect(entries.map((e) => e.actor)).toEqual([
      'gksoriginals',
      'ally-docs-bot[bot]',
    ]);
    expect(entries[1].pr?.title).toBe('chore: sync wiki routing index');
  });

  it('reads all three labels', () => {
    const { entries } = parseJournal(
      PREAMBLE +
        pushEntry(
          '2026-09-03T00:00:00Z',
          'ally-be',
          'Needs a release note',
          'raw',
          [['fix: c', 'ccccccc']],
        ) +
        pushEntry('2026-09-02T00:00:00Z', 'ally-be', 'Internal', 'b', [
          ['fix: b', 'bbbbbbb'],
        ]) +
        pushEntry('2026-09-01T00:00:00Z', 'ally-be', 'For release notes', 'a', [
          ['fix: a', 'aaaaaaa'],
        ]),
    );

    expect(entries.map((e) => e.label)).toEqual([
      'public',
      'internal',
      'needs_release_note',
    ]);
  });

  it('returns entries oldest first, the order they happened in', () => {
    const { entries } = parseJournal(
      PREAMBLE +
        pushEntry('2026-09-03T00:00:00Z', 'ally-be', 'Internal', 'newest', [
          ['fix: n', '1111111'],
        ]) +
        pushEntry('2026-09-01T00:00:00Z', 'ally-be', 'Internal', 'oldest', [
          ['fix: o', '2222222'],
        ]),
    );

    expect(entries.map((e) => e.noteText)).toEqual(['oldest', 'newest']);
  });

  it('keeps a before sha written as a parent reference', () => {
    const text =
      PREAMBLE +
      `## 2026-09-01T00:00:00Z — infra\n- **Internal:** x\n- **Technical:** 1 commit(s) · [compare](https://github.com/HelloAllyTech/infra/compare/abc1234def^...abc1234def5678) · @someone\n  - chore: y (abc1234)\n`;

    const { entries } = parseJournal(text);

    expect(entries[0].compare).toMatchObject({
      before: 'abc1234def^',
      after: 'abc1234def5678',
    });
  });

  it('does not mistake the preamble for an entry', () => {
    expect(parseJournal(PREAMBLE).entries).toEqual([]);
  });

  it('skips and counts a block whose timestamp or label will not parse', () => {
    const { entries, skipped } = parseJournal(
      PREAMBLE +
        pushEntry('not-a-date', 'ally-be', 'Internal', 'x', [
          ['fix: a', 'aaaaaaa'],
        ]) +
        '## 2026-09-01T00:00:00Z — ally-be\n- **Something else:** x\n\n' +
        pushEntry('2026-09-02T00:00:00Z', 'ally-be', 'Internal', 'fine', [
          ['fix: b', 'bbbbbbb'],
        ]),
    );

    expect(skipped).toBe(2);
    expect(entries.map((e) => e.noteText)).toEqual(['fine']);
  });

  it('keeps an id stable when the text is corrected, and distinct for a same-second twin', () => {
    const one = parseJournal(
      PREAMBLE +
        pushEntry('2026-09-01T00:00:00Z', 'ally-be', 'Internal', 'before', [
          ['fix: a', 'aaaaaaa'],
        ]),
    ).entries[0];
    const corrected = parseJournal(
      PREAMBLE +
        pushEntry(
          '2026-09-01T00:00:00Z',
          'ally-be',
          'For release notes',
          'after',
          [['fix: a', 'aaaaaaa']],
        ),
    ).entries[0];
    const twins = parseJournal(
      PREAMBLE +
        pushEntry('2026-09-01T00:00:00Z', 'ally-be', 'Internal', 'one', [
          ['fix: a', 'aaaaaaa'],
        ]) +
        pushEntry('2026-09-01T00:00:00Z', 'ally-be', 'Internal', 'two', [
          ['fix: b', 'bbbbbbb'],
        ]),
    ).entries;

    expect(corrected.id).toBe(one.id);
    expect(new Set(twins.map((e) => e.id)).size).toBe(2);
  });
});
