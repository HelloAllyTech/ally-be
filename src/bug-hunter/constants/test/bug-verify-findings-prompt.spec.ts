import { buildVerifyFindingsPrompt } from '../bug-verify-findings-prompt';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingSource } from '../../enum/bug-finding.enum';

const finding = (over: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    title: 'Simulation titles stay in English with Marathi selected',
    description: 'Titles and descriptions in the Simulations tab stay English.',
    source: BugFindingSource.CODE_REVIEW,
    proven: false,
    metadata: {},
    ...over,
  }) as BugFinding;

const build = (findings: BugFinding[]) =>
  buildVerifyFindingsPrompt({
    findings,
    repo: 'ally-web',
    runId: 'run-v',
    apiBaseUrl: 'https://api.example.com',
    engine: 'gemini',
    model: 'gemini-2.5-pro',
    sweepEngine: 'opencode',
  });

describe('buildVerifyFindingsPrompt — locate before fixing', () => {
  it('tells the verifier to probe production and name the layer for a human report', () => {
    const p = build([finding({ source: BugFindingSource.REPORTED_BUG })]);
    expect(p).toContain('A person reported the bug below');
    expect(p).toContain(
      '## Human reports: locate the fault before anything else',
    );
    expect(p).toContain('A HUMAN REPORT: locate the fault before you judge it');
    expect(p).toContain('https://api.example.com/i18n/manifest.json');
    expect(p).toContain(
      'https://api.example.com/api/v1/learn/scenarios/<id>/public?languageCode=<lang>',
    );
    expect(p).toContain(
      'https://api.example.com/api/v1/tooltips/active?languageCode=<lang>',
    );
    expect(p).toContain('Do NOT propose a code change for a data fault');
    expect(p).toContain('"faultLayer":"<code|data|config|unknown>"');
    expect(p).toContain('"productionEvidence"');
    expect(p).toContain('"repair"');
    expect(p).toContain(
      'a confirmed data or config fault goes to a person with your repair and never to a fix session',
    );
  });

  it('keeps the sweep wording and leaves the fault fields out for sweep findings', () => {
    const p = build([finding()]);
    expect(p).toContain('A nightly sweep of "ally-web" running on opencode');
    expect(p).not.toContain('## Human reports');
    expect(p).toContain('## Name the layer');
    expect(p).toContain('"faultLayer":"<code|data|config|unknown>"');
  });
});

describe('buildVerifyFindingsPrompt — the held check', () => {
  it("re-runs the reporter's steps against production and reports held true or false", () => {
    const p = buildVerifyFindingsPrompt({
      findings: [
        finding({
          source: BugFindingSource.REPORTED_BUG,
          status: 'released' as never,
          prUrl: 'https://github.com/HelloAllyTech/ally-web/pull/798',
          description:
            'Titles stay English.\nSteps: pick Marathi; open Simulations.',
        }),
      ],
      repo: 'ally-web',
      runId: 'run-h',
      apiBaseUrl: 'https://api.example.com',
      engine: 'gemini',
      model: 'gemini-2.5-pro',
      sweepEngine: null,
      heldCheck: true,
    });
    expect(p).toContain('closing the loop on a fix that has been RELEASED');
    expect(p).toContain(
      "The reporter's steps: pick Marathi; open Simulations.",
    );
    expect(p).toContain(
      'https://api.example.com/api/v1/learn/scenarios/<id>/public?languageCode=<lang>',
    );
    expect(p).toContain('"heldCheck":{"runId":"run-h","held":<true|false>');
    expect(p).not.toContain('## For each finding, in order');
  });

  it('renders what Bug Hunter knows about each finding, and the toolbox, as data', () => {
    const p = buildVerifyFindingsPrompt({
      findings: [finding({ source: BugFindingSource.REPORTED_BUG })],
      repo: 'ally-web',
      runId: 'run-v',
      apiBaseUrl: 'https://api.example.com',
      engine: 'gemini',
      model: 'gemini-2.5-pro',
      sweepEngine: null,
      knowledge: {
        'f-1': {
          playbooks: [],
          featureCards: [],
          precedents: [
            {
              id: 'f-0',
              title: 'Tooltip stays English in Marathi',
              repo: 'ally-web',
              status: 'released',
              prUrl: null,
              fault: {
                layer: 'data',
                repo: 'ally-be',
                repair: 'translate the tooltips',
              },
              wrongFix: null,
              declined: null,
            },
          ],
        },
      },
    });
    expect(p).toContain('## What Bug Hunter already knows about f-1');
    expect(p).toContain(
      'Fault located in data (ally-be); repair: translate the tooltips.',
    );
    expect(p).toContain('## Your tools for locating the fault');
    expect(p).toContain('pipeline/probes/<name>');
    expect(p.indexOf('What Bug Hunter already knows')).toBeLessThan(
      p.indexOf('## Human reports'),
    );
  });
});
