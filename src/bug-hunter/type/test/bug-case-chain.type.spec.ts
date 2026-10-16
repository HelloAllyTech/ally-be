import {
  buildCaseChain,
  chainRefusal,
  ChainInput,
} from '../bug-case-chain.type';
import {
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';

const report = (over: Partial<ChainInput> = {}): ChainInput => ({
  source: BugFindingSource.REPORTED_BUG,
  proven: false,
  evidence: null,
  description:
    'Titles stay English with Marathi selected.\n\nExpected: Marathi.\nSteps: pick मराठी; open Simulations; read the titles.\nWhere: Helpline web app',
  file: null,
  status: BugFindingStatus.NEW,
  prUrl: null,
  metadata: {},
  ...over,
});

const study = (valueLivesIn: string) => ({
  feature: 'f',
  howItWorksToday: ['a', 'b'],
  valueLivesIn,
  rootCause: 'r',
  approach: 'a',
  filesToChange: ['x.ts'],
  testPlan: 't',
  recordedAt: '2026-10-12T00:00:00.000Z',
  runId: 'run-1',
});

const byLink = (c: ReturnType<typeof buildCaseChain>) =>
  Object.fromEntries(c.links.map((l) => [l.link, l.status]));

describe('buildCaseChain', () => {
  it('a fresh human report with steps has only the symptom observed', () => {
    const c = buildCaseChain(report());
    expect(byLink(c)).toEqual({
      observed: 'present',
      reproduced: 'missing',
      located: 'missing',
      changed: 'missing',
      resolved: 'missing',
      held: 'missing',
    });
    expect(c.mergeable).toBe(false);
    expect(c.blocking).toEqual([
      'reproduced',
      'located',
      'changed',
      'resolved',
    ]);
  });

  it('a report without steps is a weak observation; a proven sweep finding observes and reproduces itself', () => {
    expect(
      byLink(buildCaseChain(report({ description: 'It is broken.' }))).observed,
    ).toBe('weak');
    const proven = buildCaseChain(
      report({
        source: BugFindingSource.TEST_FAILURE,
        proven: true,
        evidence: 'FAIL x.spec.ts',
        file: 'x.ts',
      }),
    );
    expect(byLink(proven)).toMatchObject({
      observed: 'present',
      reproduced: 'present',
      located: 'weak',
    });
  });

  it('the weekend bug: located in data, changed in a locale file, test green — the chain breaks at changed', () => {
    const c = buildCaseChain(
      report({
        status: BugFindingStatus.PR_OPENED,
        prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/798',
        metadata: {
          findingVerdicts: [
            {
              verdict: 'confirmed',
              reproduction:
                'GET scenarios/public?languageCode=mr returns English titles',
              fault: {
                layer: 'data',
                repo: 'ally-be',
                evidence: 'no mr rows',
                repair: 'publish translations',
              },
            },
          ],
          study: study('locale_file'),
          fixVerdicts: [
            {
              verdict: 'pass',
              prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/798',
              checks: [
                { name: 'repro_at_head_passes', ok: true, evidence: 'green' },
              ],
            },
          ],
        },
      }),
    );
    expect(byLink(c)).toEqual({
      observed: 'present',
      reproduced: 'present',
      located: 'present',
      changed: 'broken',
      resolved: 'weak',
      held: 'missing',
    });
    expect(c.blocking).toEqual(['changed']);
    expect(chainRefusal(c)).toMatch(
      /changed in that mechanism is broken \(the fault is in data and the change is in locale_file\)/,
    );
  });

  it('breaks "changed" on a one-repo PR whose own study says other repos must change (2026-10-16 OTP)', () => {
    const otp = (over: Partial<ChainInput> = {}) =>
      buildCaseChain(
        report({
          prUrl: 'https://github.com/HelloAllyTech/ally-be/pull/643',
          metadata: {
            study: {
              ...study('code'),
              otherRepos: ['ally-web', 'ally-mobile'],
            },
          },
          ...over,
        }),
      );
    const changed = otp().links.find((l) => l.link === 'changed');
    expect(changed).toMatchObject({ status: 'broken' });
    expect(changed?.evidence).toMatch(
      /a half-fix: the study says ally-web, ally-mobile must change too/,
    );
    // A step of a cross-repo plan is one half by design.
    expect(
      otp({ parentFindingId: 'parent-1' }).links.find(
        (l) => l.link === 'changed',
      )?.status,
    ).toBe('present');
  });

  it('a complete chain merges, and the symptom check decides resolved', () => {
    const base = report({
      status: BugFindingStatus.PR_OPENED,
      prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/800',
      metadata: {
        findingVerdicts: [
          {
            verdict: 'confirmed',
            reproduction: 'seen',
            fault: {
              layer: 'code',
              repo: 'ally-web',
              evidence: 'e',
              repair: null,
            },
          },
        ],
        study: study('code'),
        fixVerdicts: [
          {
            verdict: 'pass',
            prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/800',
            checks: [
              {
                name: 'symptom_resolved',
                ok: true,
                evidence: 'titles now Marathi at head',
              },
            ],
          },
        ],
      },
    });
    const c = buildCaseChain(base);
    expect(byLink(c)).toMatchObject({
      changed: 'present',
      resolved: 'present',
    });
    expect(c.mergeable).toBe(true);

    const stillThere = buildCaseChain({
      ...base,
      metadata: {
        ...base.metadata,
        fixVerdicts: [
          {
            verdict: 'pass',
            prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/800',
            checks: [
              {
                name: 'symptom_resolved',
                ok: false,
                evidence: 'still English',
              },
            ],
          },
        ],
      },
    });
    expect(byLink(stillThere).resolved).toBe('broken');
    expect(stillThere.mergeable).toBe(false);
  });

  it('held reads the release, the post-release check and a regression', () => {
    const released = report({ status: BugFindingStatus.RELEASED });
    expect(byLink(buildCaseChain(released)).held).toBe('weak');
    expect(
      byLink(
        buildCaseChain({
          ...released,
          metadata: { heldInProduction: { ok: true, evidence: 'gone' } },
        }),
      ).held,
    ).toBe('present');
    expect(
      byLink(
        buildCaseChain({
          ...released,
          metadata: { heldInProduction: { ok: false, evidence: 'back' } },
        }),
      ).held,
    ).toBe('broken');
    expect(
      byLink(buildCaseChain({ ...released, metadata: { regressed: true } }))
        .held,
    ).toBe('broken');
  });
});
