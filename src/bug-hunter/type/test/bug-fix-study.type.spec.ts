import {
  readBugFixStudy,
  renderBugFixStudyLines,
  toBugFixStudy,
} from '../bug-fix-study.type';

const good = {
  feature: 'Tooltips on the helpline screens, in the selected language',
  entryPoints: [
    'apps/ally-helpline-dashboard/src/components/app-tooltip/AppTooltip.tsx',
  ],
  howItWorksToday: [
    'tooltips + tooltip_translations tables — admin edits under Manage Tooltips',
    'GET /v1/tooltips/active (tooltip.controller.ts) translates by language',
    'AppTooltip.tsx calls useGetActiveTooltipsQuery with no language',
  ],
  valueLivesIn: 'database',
  workingSibling:
    'Checklist.tsx passes languageCode: i18n.language to its query',
  rootCause:
    'The app never sends its language, so the server answers in English.',
  approach:
    'Pass i18n.language as languageCode from AppTooltip; accept it on the endpoint.',
  filesToChange: ['AppTooltip.tsx', 'api/tooltips.ts'],
  leaveAlone: ['en.json — tooltips are not locale keys'],
  otherRepos: ['ally-be'],
  risks: ['cache key changes per language'],
  testPlan:
    'AppTooltip.test.tsx: the hook is called with { languageCode: "mr" } after changeLanguage("mr")',
};

describe('toBugFixStudy', () => {
  it('accepts a complete study and stamps it', () => {
    const out = toBugFixStudy(good, {
      runId: 'run-1',
      now: new Date('2026-10-10T08:00:00.000Z'),
    });
    expect(out.missing).toEqual([]);
    expect(out.study).toMatchObject({
      valueLivesIn: 'database',
      runId: 'run-1',
      recordedAt: '2026-10-10T08:00:00.000Z',
      review: null,
      otherRepos: ['ally-be'],
    });
  });

  it('names every missing field, and treats a home off the menu as missing', () => {
    const out = toBugFixStudy(
      {
        feature: 'x',
        howItWorksToday: ['one step'],
        valueLivesIn: 'somewhere',
      },
      { runId: null },
    );
    expect(out.study).toBeNull();
    expect(out.missing).toEqual([
      'howItWorksToday (at least 2 steps, each naming a file or symbol)',
      'valueLivesIn (one of database, locale_file, config, code, other_repo, mixed)',
      'rootCause',
      'approach',
      'filesToChange',
      'testPlan',
    ]);
  });

  it('drops junk in lists rather than failing on it, and clips long text', () => {
    const out = toBugFixStudy(
      { ...good, risks: [1, null, 'real'], approach: 'a'.repeat(2000) },
      { runId: null },
    );
    expect(out.study?.risks).toEqual(['real']);
    expect(out.study?.approach.length).toBe(1200);
  });
});

describe('readBugFixStudy', () => {
  it('reads a stored study back with its review, and null for none or an old shape', () => {
    const stored = {
      ...good,
      recordedAt: '2026-10-10T08:00:00.000Z',
      runId: 'run-1',
      review: {
        concerns: ['no sender named', 7],
        model: 'gemini-2.5-flash',
        at: 'x',
      },
    };
    const study = readBugFixStudy({ study: stored });
    expect(study?.review).toEqual({
      concerns: ['no sender named'],
      model: 'gemini-2.5-flash',
      at: 'x',
    });
    expect(study?.recordedAt).toBe('2026-10-10T08:00:00.000Z');
    expect(readBugFixStudy({})).toBeNull();
    expect(readBugFixStudy({ study: { feature: 'half' } })).toBeNull();
  });
});

describe('renderBugFixStudyLines', () => {
  it('renders the path as numbered steps and says where the value lives in words', () => {
    const { study } = toBugFixStudy(good, { runId: null });
    const lines = renderBugFixStudyLines({
      ...study!,
      review: { concerns: [], model: 'gemini-2.5-flash', at: '' },
    });
    expect(lines).toContain(
      '    1. tooltips + tooltip_translations tables — admin edits under Manage Tooltips',
    );
    expect(lines).toContain(
      '- The value lives in: a database table (admin-editable content)',
    );
    expect(lines).toContain('- Review by gemini-2.5-flash: no concerns.');
    expect(lines.join('\n')).toContain(
      'Other repos a complete fix needs: ally-be',
    );
  });
});
