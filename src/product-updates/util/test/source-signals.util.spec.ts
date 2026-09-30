import {
  SourceSignalsInput,
  buildClusters,
  clusterKeys,
  gatesLiveness,
  isNoise,
  linkedPullRequests,
  looksStaffOnly,
  normaliseBranch,
} from '../source-signals.util';

const at = (iso: string) => new Date(iso);

const source = (
  overrides: Partial<SourceSignalsInput>,
): SourceSignalsInput => ({
  repo: 'ally-be',
  author: 'sandeepmalhotra-ally',
  mergedAt: at('2026-09-30T08:00:00Z'),
  headRef: null,
  prNumber: null,
  subjects: ['feat(thing): do a thing'],
  body: null,
  files: ['src/thing/thing.service.ts'],
  ...overrides,
});

describe('normaliseBranch', () => {
  it('strips the change-type prefix so repos compare on the feature name', () => {
    expect(normaliseBranch('feat/xp-per-roleplay-minute')).toBe(
      'xp-per-roleplay-minute',
    );
    expect(normaliseBranch('fix/Character-Interview')).toBe(
      'character-interview',
    );
  });

  it('ignores branches every docs sync shares', () => {
    expect(normaliseBranch('chore/sync-wiki-routing')).toBeNull();
    expect(normaliseBranch(null)).toBeNull();
  });
});

describe('linkedPullRequests', () => {
  it('reads both the short and the URL form', () => {
    expect(
      linkedPullRequests(
        'Backend: https://github.com/HelloAllyTech/ally-be/pull/571 — pairs with ally-web #734',
      ).sort(),
    ).toEqual(['pr:ally-be#571', 'pr:ally-web#734']);
  });
});

describe('clusterKeys', () => {
  it('includes the branch, the PR itself, its links and any roadmap or chart ids', () => {
    expect(
      clusterKeys(
        source({
          repo: 'ally-web',
          headRef: 'feat/xp-per-roleplay-minute',
          prNumber: 734,
          subjects: ['feat(admin-analytics): XP per Roleplay Minute (AAQ-165)'],
          body: 'Backend: https://github.com/HelloAllyTech/ally-be/pull/571',
        }),
      ).sort(),
    ).toEqual(
      [
        'branch:xp-per-roleplay-minute',
        'pr:ally-be#571',
        'pr:ally-web#734',
        'ticket:AAQ-165',
      ].sort(),
    );
  });
});

describe('buildClusters', () => {
  it('joins a backend PR and the frontend PR that links to it', () => {
    const clusters = buildClusters([
      source({
        repo: 'ally-be',
        prNumber: 571,
        headRef: 'feat/a',
        subjects: ['feat(analytics-xp): endpoint'],
      }),
      source({
        repo: 'ally-web',
        prNumber: 734,
        headRef: 'feat/b',
        subjects: ['feat(admin-analytics): chart'],
        body: 'Backend: ally-be#571',
      }),
      source({
        repo: 'ally-web',
        prNumber: 735,
        headRef: 'feat/c',
        subjects: ['feat(skills): another chart'],
      }),
    ]);

    expect(clusters).toEqual([[0, 1], [2]]);
  });

  it("chains one person's commits on a specific scope within the window", () => {
    const clusters = buildClusters([
      source({
        author: 'gksoriginals',
        subjects: ['feat(openers): plan'],
        mergedAt: at('2026-09-29T05:53:00Z'),
      }),
      source({
        author: 'gksoriginals',
        subjects: ['fix(openers): echo'],
        mergedAt: at('2026-09-29T09:30:00Z'),
      }),
      source({
        author: 'gksoriginals',
        subjects: ['fix(openers): silences'],
        mergedAt: at('2026-09-30T08:52:00Z'),
      }),
      source({
        author: 'gksoriginals',
        subjects: ['fix(openers): much later'],
        mergedAt: at('2026-10-09T08:52:00Z'),
      }),
    ]);

    expect(clusters).toEqual([[0, 1, 2], [3]]);
  });

  it('does not chain on a generic scope or for a bot', () => {
    const clusters = buildClusters([
      source({ subjects: ['fix(helpline): one'] }),
      source({ subjects: ['fix(helpline): two'] }),
      source({
        author: 'adminbughunterhelloallyai',
        subjects: ['fix(badge): a'],
      }),
      source({
        author: 'adminbughunterhelloallyai',
        subjects: ['fix(badge): b'],
      }),
    ]);

    expect(clusters).toHaveLength(4);
  });
});

describe('isNoise', () => {
  it('treats a change made only of tests and docs as noise', () => {
    expect(
      isNoise(
        source({
          files: [
            'src/x/test/x.spec.ts',
            'docs/x.md',
            '.github/workflows/y.yml',
          ],
        }),
      ),
    ).toBe(true);
  });

  it('keeps a change with one real source file', () => {
    expect(
      isNoise(
        source({ files: ['src/x/test/x.spec.ts', 'src/x/x.service.ts'] }),
      ),
    ).toBe(false);
  });

  it('treats version bumps, wiki syncs and the docs bot as noise', () => {
    expect(
      isNoise(
        source({
          subjects: ['chore(release): bump version to 1.23.34 [automated]'],
        }),
      ),
    ).toBe(true);
    expect(isNoise(source({ author: 'ally-docs-bot[bot]' }))).toBe(true);
  });

  it('does not mistake a feature about formats for a formatting fix', () => {
    expect(
      isNoise(source({ subjects: ['feat(formats): export as PDF'] })),
    ).toBe(false);
  });

  it('falls back to commit types when no file list is available', () => {
    expect(
      isNoise(source({ files: [], subjects: ['test: a', 'docs(x): b'] })),
    ).toBe(true);
    expect(
      isNoise(source({ files: [], subjects: ['test: a', 'fix: b'] })),
    ).toBe(false);
  });
});

describe('gatesLiveness', () => {
  it('lets a docs-only change ride along without holding the feature back', () => {
    expect(gatesLiveness(source({ files: ['docs/a.md'] }))).toBe(false);
    expect(gatesLiveness(source({ files: ['src/a.ts'] }))).toBe(true);
    expect(gatesLiveness(source({ files: [] }))).toBe(true);
  });
});

describe('looksStaffOnly', () => {
  it('flags a change confined to staff tools', () => {
    expect(
      looksStaffOnly(
        source({
          files: [
            'src/bug-hunter/service/x.ts',
            'apps/ally-admin-dashboard/src/pages/BugHunter/X.tsx',
            'src/bug-hunter/service/test/x.spec.ts',
          ],
        }),
      ),
    ).toBe(true);
  });

  it('does not flag a change that also touches a customer surface', () => {
    expect(
      looksStaffOnly(
        source({
          files: [
            'src/analytics/x.ts',
            'apps/ally-helpline-dashboard/src/pages/Statistics/X.tsx',
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe('looksStaffOnly — scopes, chart ids and customer surfaces', () => {
  it('treats a change whose every subject names a staff tool as staff-only', () => {
    expect(
      looksStaffOnly(
        source({
          subjects: ['fix(builder): show distinct error in notification bell'],
          files: [
            'apps/ally-admin-dashboard/src/components/notification-bell/Bell.tsx',
          ],
        }),
      ),
    ).toBe(true);
    expect(
      looksStaffOnly(
        source({
          subjects: ['Bug Hunter: a Notebook tab'],
          files: ['src/x/y.ts'],
        }),
      ),
    ).toBe(true);
  });

  it('treats an admin analytics chart id as staff-only even with shared admin files', () => {
    expect(
      looksStaffOnly(
        source({
          subjects: [
            'feat(admin-analytics): XP per Roleplay Minute chart (AAQ-165)',
          ],
          files: [
            'apps/ally-admin-dashboard/src/pages/Analytics/XpPerMinute.tsx',
            'apps/ally-admin-dashboard/src/api/analytics.ts',
            'apps/ally-admin-dashboard/src/constants/common.ts',
          ],
        }),
      ),
    ).toBe(true);
  });

  it('never treats a change that reaches a customer app as staff-only', () => {
    expect(
      looksStaffOnly(
        source({
          repo: 'ally-web',
          subjects: [
            'fix(helpline/analytics): make the org-metrics reorder land',
          ],
          files: [
            'apps/ally-helpline-dashboard/src/pages/statistics/OrgMetrics.tsx',
          ],
        }),
      ),
    ).toBe(false);
  });
});
