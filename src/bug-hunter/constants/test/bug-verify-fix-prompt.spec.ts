import { BugCaseFile } from '../bug-case-file';
import { buildVerifyFixPrompt } from '../bug-verify-fix-prompt';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingSource } from '../../enum/bug-finding.enum';
import { BugFixStudy } from '../../type/bug-fix-study.type';

const finding = (): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    title: 'Tooltips stay in English after the language switch',
    description: 'With Marathi selected the tooltips stay in English.',
    file: 'AppTooltip.tsx',
    prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/792',
  }) as BugFinding;

const study: BugFixStudy = {
  feature: 'CMS tooltips in the selected language',
  entryPoints: ['AppTooltip.tsx'],
  howItWorksToday: [
    'tooltips + tooltip_translations tables, edited under Manage Tooltips',
    'GET /v1/tooltips/active translates by language',
    'AppTooltip.tsx fetches without a language',
  ],
  valueLivesIn: 'database',
  workingSibling: 'Checklist.tsx passes languageCode: i18n.language',
  rootCause: 'The app never sends its language.',
  approach: 'Send languageCode from AppTooltip; accept it on the endpoint.',
  filesToChange: ['AppTooltip.tsx', 'api/tooltips.ts'],
  leaveAlone: ['en.json'],
  otherRepos: ['ally-be'],
  risks: [],
  testPlan: 'AppTooltip.test.tsx asserts the language is passed',
  previousStudyWasWrongBecause: null,
  recordedAt: '2026-10-10T08:00:00.000Z',
  runId: 'run-fix',
  review: { concerns: [], model: 'gemini-2.5-flash', at: 'x' },
};

const caseFile = (over: Partial<BugCaseFile> = {}): BugCaseFile => ({
  finding: {
    id: 'f-1',
    repo: 'ally-web',
    title: 't',
    description: 'd',
    originalDescription: null,
    file: null,
    symbol: null,
    source: BugFindingSource.REPORTED_BUG,
    severity: null,
    proven: false,
    evidence: null,
    touchesGuardedPath: false,
    status: 'pr_opened',
    prUrl: null,
    createdAt: new Date(),
  },
  reporter: null,
  miss: null,
  verdicts: [],
  sessions: [],
  postmortem: null,
  study: null,
  lineage: { regressionOf: null, regressed: false, rediscoveredCount: 0 },
  budget: {
    caps: { sessions: 2, attempts: 4, escalations: 1, usd: 15, minutes: 120 },
    used: { sessions: 1, attempts: 1, escalations: 0, usd: 1, minutes: 5 },
    exhausted: null,
    overriddenBy: null,
    overriddenAt: null,
  },
  decisions: [],
  totals: { sessions: 1, attempts: 1, verdicts: 0 },
  ...over,
});

const build = (cf: BugCaseFile, repo = 'ally-web') =>
  buildVerifyFixPrompt({
    finding: finding(),
    caseFile: cf,
    repo,
    runId: 'run-verify',
    apiBaseUrl: 'https://api.example.com',
    prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/792',
    prNumber: 792,
    engine: 'gemini',
    model: 'gemini-2.5-pro',
    fixEngine: 'opencode',
  });

describe('buildVerifyFixPrompt — the study check', () => {
  it("renders the fixer's study as data and asks for the diff to be compared with it", () => {
    const p = build(caseFile({ study }));
    expect(p).toContain("## The fixer's study — claims to test, not facts");
    expect(p).toContain('--- BEGIN DATA: study ---');
    expect(p).toContain(
      'The value lives in: a database table (admin-editable content)',
    );
    expect(p).toMatch(
      /8\. study_followed\. Compare the diff with the fixer's study/,
    );
    // The three wrong turns the check exists for, by name.
    expect(p).toContain(
      'A locale key or a constant for text that lives in a database table',
    );
    expect(p).toContain('gh search code');
    expect(p).toContain('--repo HelloAllyTech/<repo> for ally-be');
    expect(p).toContain('removes or hard-codes an accessibility attribute');
    expect(p).toContain('{"name":"study_followed"');
  });

  it('skips the check with a reason when no study exists, but keeps the mechanism question', () => {
    const p = build(caseFile());
    expect(p).not.toContain("## The fixer's study");
    expect(p).toMatch(/8\. study_followed\. The case file has no study/);
    expect(p).toContain('Skip with reason "no study on file"');
    expect(p).toContain('not a locale key for database content');
  });

  it('names the client repos for a backend fix', () => {
    const p = build(caseFile({ study }), 'ally-be');
    expect(p).toContain('for ally-web, ally-mobile');
  });
});
