import {
  ClusterInput,
  buildConsolidationInput,
  extractJson,
  parseConsolidationOutput,
  summariseFiles,
} from '../consolidation.util';

const cluster = (
  id: string,
  overrides: Partial<ClusterInput['sources'][0]> = {},
): ClusterInput => ({
  id,
  sources: [
    {
      repo: 'ally-web',
      prNumber: 733,
      headRef: 'fix/helpline-character-interview-save-voice',
      author: 'sandeepmalhotra-ally',
      mergedAt: new Date('2026-09-30T06:42:37Z'),
      subjects: [
        'fix(helpline): recover, restart and fully save character interviews',
      ],
      body: '## What was broken\nA finished character looked lost.\n\n## Verification\n- vitest: 214 files passed\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)',
      files: [
        'apps/ally-helpline-dashboard/src/pages/CharacterInterview/Page.tsx',
        'apps/ally-helpline-dashboard/src/pages/CharacterInterview/__tests__/Page.test.tsx',
      ],
      staffOnlyHint: false,
      ...overrides,
    },
  ],
});

const newDecision = (
  clusterIds: string[],
  update: Record<string, unknown> = {},
) => ({
  clusterIds,
  action: 'new',
  update: {
    title: 'Creating a character by interview is more reliable.',
    summary: 'The review form always opens when the interview finishes.',
    teamNotes: '- Helpline port of the admin interview.',
    kind: 'improved',
    audience: 'public',
    surfaces: ['web_app'],
    area: 'Characters',
    confidence: 0.85,
    ...update,
  },
  reason: 'User-visible fix.',
});

describe('summariseFiles', () => {
  it('groups paths by directory, busiest first', () => {
    expect(
      summariseFiles([
        'apps/ally-admin-dashboard/src/pages/Analytics/A.tsx',
        'apps/ally-admin-dashboard/src/pages/Analytics/B.tsx',
        'src/analytics/service/x.ts',
      ]),
    ).toBe(
      'apps/ally-admin-dashboard/src/pages/Analytics (2), src/analytics (1)',
    );
  });
});

describe('buildConsolidationInput', () => {
  it('describes each change and drops verification boilerplate', () => {
    const text = buildConsolidationInput([cluster('c1')], []);

    expect(text).toContain('### Cluster c1');
    expect(text).toContain('ally-web pull request #733');
    expect(text).toContain('A finished character looked lost.');
    expect(text).not.toContain('vitest: 214');
    expect(text).not.toContain('Generated with');
    expect(text).toContain('OPEN UPDATES\n\n(none)');
  });

  it('lists every commit of a direct push and flags staff-only files', () => {
    const text = buildConsolidationInput(
      [
        cluster('c2', {
          prNumber: null,
          headRef: null,
          subjects: ['feat(bug-hunter): a', 'fix(bug-hunter): b'],
          staffOnlyHint: true,
        }),
      ],
      [],
    );

    expect(text).toContain('direct push by sandeepmalhotra-ally');
    expect(text).toContain('• feat(bug-hunter): a');
    expect(text).toContain('Hint: staff-only files');
  });

  it('tells the model which open-update fields a person edited', () => {
    const text = buildConsolidationInput(
      [cluster('c1')],
      [
        {
          id: 'u1',
          title: 'T',
          summary: 'S',
          kind: 'new',
          audience: 'public',
          surfaces: ['web_app'],
          published: true,
          editedFields: ['title'],
          sourceSubjects: ['feat: x'],
        },
      ],
    );

    expect(text).toContain('Edited by a person (never return these): title');
    expect(text).toContain('Published: yes');
  });
});

describe('extractJson', () => {
  it('reads JSON inside a code fence or surrounded by prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
    expect(() => extractJson('no json here')).toThrow();
  });
});

describe('parseConsolidationOutput', () => {
  it('accepts a well-formed reply and normalises the text', () => {
    const parsed = parseConsolidationOutput(
      JSON.stringify({
        decisions: [
          newDecision(['c1', 'c2']),
          { clusterIds: ['c3'], action: 'noise', reason: 'Lint only.' },
        ],
      }),
      ['c1', 'c2', 'c3'],
      [],
    );

    expect(parsed.problems).toEqual([]);
    expect(parsed.unresolvedClusterIds).toEqual([]);
    expect(parsed.decisions[0]).toMatchObject({
      action: 'new',
      clusterIds: ['c1', 'c2'],
      update: {
        title: 'Creating a character by interview is more reliable',
        kind: 'improved',
      },
    });
  });

  it('sends clusters it cannot trust back to the queue', () => {
    const parsed = parseConsolidationOutput(
      JSON.stringify({
        decisions: [
          newDecision(['c1']),
          newDecision(['c1', 'c2']),
          {
            clusterIds: ['c3'],
            action: 'attach',
            updateId: 'not-open',
            reason: '',
          },
          newDecision(['c4'], { title: undefined }),
          newDecision(['zz']),
        ],
      }),
      ['c1', 'c2', 'c3', 'c4'],
      ['u1'],
    );

    expect(parsed.decisions).toEqual([]);
    expect(parsed.unresolvedClusterIds).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(parsed.problems.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps an update private when the model leaves out the audience', () => {
    const parsed = parseConsolidationOutput(
      JSON.stringify({
        decisions: [newDecision(['c1'], { audience: 'everyone' })],
      }),
      ['c1'],
      [],
    );

    expect(parsed.decisions[0]).toMatchObject({
      action: 'new',
      update: { audience: 'internal', confidence: 0.85 },
    });
  });

  it('drops invalid fields from an attach but keeps the valid ones', () => {
    const parsed = parseConsolidationOutput(
      JSON.stringify({
        decisions: [
          {
            clusterIds: ['c1'],
            action: 'attach',
            updateId: 'u1',
            update: {
              summary: 'Better now.',
              kind: 'sideways',
              surfaces: ['moon'],
            },
            reason: 'Follow-up fix.',
          },
        ],
      }),
      ['c1'],
      ['u1'],
    );

    expect(parsed.decisions[0]).toEqual({
      action: 'attach',
      clusterIds: ['c1'],
      updateId: 'u1',
      update: { summary: 'Better now.' },
      reason: 'Follow-up fix.',
    });
  });

  it('treats an unparseable reply as nothing decided', () => {
    const parsed = parseConsolidationOutput('I could not do this.', ['c1'], []);

    expect(parsed.decisions).toEqual([]);
    expect(parsed.unresolvedClusterIds).toEqual(['c1']);
  });
});
