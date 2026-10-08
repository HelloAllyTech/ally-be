import { BugCaseFile } from '../bug-case-file';
import {
  PR_BODY_SLOT_CHANGE,
  PR_BODY_SLOT_UNTOUCHED,
  renderPrBody,
} from '../bug-pr-body';
import { BugHuntDecision } from '../../entity/bug-hunt-decision.entity';
import { BugFindingSource } from '../../enum/bug-finding.enum';

const caseFile = (over: Partial<BugCaseFile> = {}): BugCaseFile => ({
  finding: {
    id: 'f-1',
    repo: 'ally-web',
    title: 'Marathi keys missing',
    description:
      'Four keys added to en.json were never synced, so Marathi shows English.',
    originalDescription: null,
    file: 'apps/ally-helpline-dashboard/src/i18n/locales/mr.json',
    symbol: 'locale-parity',
    source: BugFindingSource.LOCALE_PARITY,
    severity: 'medium' as never,
    proven: true,
    evidence: null,
    touchesGuardedPath: false,
    status: 'fixing',
    prUrl: null,
    createdAt: new Date('2026-10-08T00:00:00.000Z'),
  },
  reporter: null,
  miss: null,
  verdicts: [],
  sessions: [],
  postmortem: null,
  lineage: { regressionOf: null, regressed: false, rediscoveredCount: 0 },
  budget: {
    caps: { sessions: 2, attempts: 4, escalations: 1, usd: 15, minutes: 120 },
    used: { sessions: 1, attempts: 1, escalations: 0, usd: 2.5, minutes: 14.4 },
    exhausted: null,
    overriddenBy: null,
    overriddenAt: null,
  },
  decisions: [],
  totals: { sessions: 1, attempts: 1, verdicts: 0 },
  ...over,
});

const decision = (over: Partial<BugHuntDecision>): BugHuntDecision =>
  ({
    id: 'd',
    runId: null,
    findingId: 'f-1',
    repo: 'ally-web',
    point: 'D5',
    owner: 'model',
    menu: ['fix', 'ask_human'],
    pick: 'fix',
    shadowOwner: 'rule',
    shadowPick: 'fix',
    reason: 'verified and cheap',
    inputs: null,
    model: 'gemini-2.5-flash',
    outcome: null,
    createdAt: new Date('2026-10-08T01:00:00.000Z'),
    ...over,
  }) as BugHuntDecision;

describe('renderPrBody', () => {
  it('states the bug, who found it, and that a proven finding needed no judgement; leaves the two Fixer slots', () => {
    const body = renderPrBody(caseFile(), { repo: 'ally-web' });
    expect(body).toContain('## The bug');
    expect(body).toContain('Four keys added to en.json');
    expect(body).toContain(
      '- **File:** `apps/ally-helpline-dashboard/src/i18n/locales/mr.json` · `locale-parity`',
    );
    expect(body).toContain('- **Found by:** locale parity · severity medium');
    expect(body).toContain(
      'Proven by tool output (locale parity); no judgement was needed.',
    );
    expect(body).toContain(`## The change, in words\n${PR_BODY_SLOT_CHANGE}`);
    expect(body).toContain(
      `## Left untouched on purpose\n${PR_BODY_SLOT_UNTOUCHED}`,
    );
    expect(body).toContain(
      '1 of 2 sessions · 1 of 4 attempts · $2.50 of $15 · 14 of 120 minutes',
    );
    expect(body).toContain('Bug Hunter case `f-1` on ally-web.');
    expect(body).toContain('nothing merges without a pass');
    expect(body).not.toContain('## What Bug Hunter decided');
  });

  it("quotes the independent Verifier's reproduction, the reporter, the guarded path and the decisions", () => {
    const body = renderPrBody(
      caseFile({
        finding: {
          ...caseFile().finding,
          proven: false,
          touchesGuardedPath: true,
        },
        reporter: {
          source: 'staff',
          name: 'A',
          reportedAt: new Date('2026-10-02T00:00:00.000Z'),
          context: null,
        },
        verdicts: [
          {
            kind: 'finding',
            verdict: 'confirmed',
            confidence: 0.6,
            reason: 'sweep verifier said plausible',
            checks: [],
            by: null,
            runId: 'sweep',
            at: new Date('2026-10-07T00:00:00.000Z'),
          },
          {
            kind: 'finding',
            verdict: 'confirmed',
            confidence: 0.85,
            reason: 'node scripts/i18n-parity.mjs: mr missing 4',
            checks: [],
            by: 'gemini (gemini-2.5-pro)',
            runId: 'verify',
            at: new Date('2026-10-08T00:30:00.000Z'),
          },
        ],
        decisions: [
          decision({
            id: 'd7',
            point: 'D7',
            owner: 'rule',
            pick: 'retry_fix',
            shadowOwner: 'model',
            shadowPick: 'ask_human',
            createdAt: new Date('2026-10-08T02:00:00.000Z'),
          }),
          decision({ id: 'd5' }),
          decision({
            id: 'd6',
            point: 'D6',
            pick: {
              engine: 'gemini',
              model: 'gemini-2.5-pro',
              approach: 'Add the keys.',
            },
            shadowPick: { engine: 'gemini', model: 'gemini-2.5-flash' },
            reason: 'pro merges more here',
            createdAt: new Date('2026-10-08T01:30:00.000Z'),
          }),
        ],
      }),
      {
        repo: 'ally-web',
        adminUrl: 'https://admin.example.com/bug-hunter?finding=f-1',
      },
    );
    expect(body).toContain('- **Reported by:** a staff member on 2026-10-02');
    expect(body).toContain('- **Guarded path:**');
    expect(body).toContain(
      'An independent Verifier on gemini (gemini-2.5-pro) **confirmed** this bug (85% sure):',
    );
    expect(body).toContain('> node scripts/i18n-parity.mjs: mr missing 4');
    const decided = body.slice(body.indexOf('## What Bug Hunter decided'));
    expect(decided.indexOf('**D5**')).toBeLessThan(decided.indexOf('**D6**'));
    expect(decided.indexOf('**D6**')).toBeLessThan(decided.indexOf('**D7**'));
    expect(decided).toContain('**D5** fix — by the model; verified and cheap');
    expect(decided).toContain(
      '**D6** gemini gemini-2.5-pro — by the model (the rule would have: gemini gemini-2.5-flash); pro merges more here',
    );
    expect(decided).toContain(
      '**D7** retry_fix — by the rule (the model would have: ask_human)',
    );
    expect(body).toContain(
      '[Open in the admin](https://admin.example.com/bug-hunter?finding=f-1)',
    );
  });

  it('falls back to the sweep verifiers, then to the regression test, when nothing independent judged it', () => {
    const sweepOnly = renderPrBody(
      caseFile({
        finding: { ...caseFile().finding, proven: false },
        verdicts: [
          {
            kind: 'finding',
            verdict: 'confirmed',
            confidence: 0.7,
            reason: 'r',
            checks: [],
            by: null,
            runId: 's',
            at: new Date(),
          },
          {
            kind: 'finding',
            verdict: 'refuted',
            confidence: 0.9,
            reason: 'r2',
            checks: [],
            by: null,
            runId: 's',
            at: new Date(),
          },
        ],
      }),
      { repo: 'ally-web' },
    );
    expect(sweepOnly).toContain(
      '1 of 2 sweep verifiers accepted this reading of the code (least sure: 70%).',
    );

    const nothing = renderPrBody(
      caseFile({ finding: { ...caseFile().finding, proven: false } }),
      { repo: 'ally-web' },
    );
    expect(nothing).toContain(
      'Not independently verified before this fix; the regression test in this PR is the proof.',
    );
  });
});
