import {
  normaliseBriefResponse,
  normaliseSituationBrief,
  renderBriefForModel,
  renderBriefResponse,
  resolveCitation,
} from '../builder-situation-brief.util';
import { BuilderDiscovery } from '../builder-discovery.util';

const discovery: BuilderDiscovery = {
  ranAt: '2026-10-21T00:00:00Z',
  planned: 'model',
  items: [
    {
      ref: 'E1',
      tool: 'capability_lookup',
      query: 'auto improve',
      ok: true,
      found: ['capability Auto-improve (ally-be:src/skill-experiment)'],
    },
    {
      ref: 'E2',
      tool: 'docs_search',
      query: 'debrief',
      ok: false,
      found: [],
      failure: 'rate limited',
    },
    {
      ref: 'E3',
      tool: 'github_search_code',
      query: 'rating',
      ok: true,
      found: [],
    },
  ],
};
const evidence = {
  discovery,
  sources: ['ally-web:apps/ally-admin-dashboard/src/components/DebriefTab.tsx'],
};

const goodBrief = {
  message:
    'You want learners to rate the debrief; here is what already exists.',
  exists: [
    { text: 'Auto-improve tests challenger debrief prompts', cites: ['E1'] },
    { text: 'DebriefTab on web', cites: ['components/DebriefTab.tsx'] },
  ],
  alreadyMet: [],
  proposals: [
    {
      part: 'challenger loop',
      approach: 'reuse',
      text: 'Reuse Auto-improve',
      cites: ['E1'],
    },
    { part: 'rating', approach: 'new', text: 'A thumbs rating on the debrief' },
  ],
  repos: [
    { repo: 'ally-web', why: 'the web debrief' },
    { repo: 'ally-mobile', why: 'the mobile DebriefTab' },
    { repo: 'ally-web', why: 'twice' },
    { repo: 'not-a-repo', why: 'x' },
  ],
};

describe('the situation brief', () => {
  it('resolves a discovery ref only when that lookup found something, and a path only when one was read', () => {
    expect(resolveCitation('E1', evidence)?.label).toContain('Auto-improve');
    expect(resolveCitation('e1', evidence)?.ref).toBe('E1');
    expect(resolveCitation('E2', evidence)).toBeNull(); // failed
    expect(resolveCitation('E3', evidence)).toBeNull(); // found nothing
    expect(resolveCitation('E9', evidence)).toBeNull();
    expect(resolveCitation('DebriefTab.tsx', evidence)).not.toBeNull();
    expect(resolveCitation('src/nope.ts', evidence)).toBeNull();
  });

  it('gives each line an id, keeps the citations it can resolve, and finds nothing wrong with a sound brief', () => {
    const { brief, problems } = normaliseSituationBrief(goodBrief, evidence);
    expect(problems).toEqual([]);
    expect(brief.lines.map((line) => line.id)).toEqual([
      'X1',
      'X2',
      'P1',
      'P2',
      'R1',
      'R2',
    ]);
    expect(brief.lines.find((line) => line.id === 'P1')).toMatchObject({
      kind: 'proposal',
      approach: 'reuse',
      part: 'challenger loop',
    });
    expect(
      brief.lines
        .filter((line) => line.kind === 'repo')
        .map((line) => line.repo),
    ).toEqual(['ally-web', 'ally-mobile']);
    expect(brief.id).toBeTruthy();
  });

  it('sends back what it cannot stand behind: an uncited line, a citation that matches nothing, no proposal, no repo', () => {
    const { problems } = normaliseSituationBrief(
      {
        message: '',
        exists: [
          { text: 'A rating table already exists', cites: [] },
          { text: 'Something else', cites: ['E2'] },
        ],
        proposals: [],
        repos: [],
      },
      evidence,
    );
    expect(problems.map((problem) => problem.key)).toEqual([
      'brief_uncited',
      'brief_unresolved',
      'brief_no_proposal',
      'brief_no_repo',
      'brief_no_message',
    ]);
    expect(problems[0].toModel).toContain('A rating table already exists');
  });

  it('shows what a citation found, once, however many searches found it', () => {
    const { brief } = normaliseSituationBrief(
      {
        ...goodBrief,
        exists: [{ text: 'Auto-improve', cites: ['E1', 'e1', 'E1'] }],
      },
      evidence,
    );
    expect(brief.lines[0].cites).toEqual([
      {
        ref: 'E1',
        label: 'capability Auto-improve (ally-be:src/skill-experiment)',
      },
    ]);
  });

  it('holds reuse and extend to a citation, and every proposal to an approach', () => {
    const { problems } = normaliseSituationBrief(
      {
        ...goodBrief,
        proposals: [
          { part: 'loop', approach: 'extend', text: 'Extend it', cites: [] },
          { part: 'other', approach: 'maybe', text: 'Hmm' },
        ],
      },
      evidence,
    );
    expect(problems.map((problem) => problem.key)).toEqual([
      'brief_approach',
      'brief_uncited',
    ]);
  });

  describe("the admin's answer", () => {
    const { brief } = normaliseSituationBrief(goodBrief, evidence);

    it('keeps known lines only, and a correction only with words', () => {
      expect(
        normaliseBriefResponse(brief, {
          briefId: brief.id,
          lines: [
            { id: 'X1', verdict: 'confirm' },
            {
              id: 'P2',
              verdict: 'correct',
              correction: 'Use the existing session rating',
            },
            { id: 'R2', verdict: 'correct', correction: '' },
            { id: 'Z9', verdict: 'confirm' },
          ],
          note: ' and keep it cheap ',
        }),
      ).toEqual({
        briefId: brief.id,
        lines: [
          { id: 'X1', verdict: 'confirm' },
          {
            id: 'P2',
            verdict: 'correct',
            correction: 'Use the existing session rating',
          },
          { id: 'R2', verdict: 'confirm' },
        ],
        note: 'and keep it cheap',
      });
    });

    it('renders as one message the model and the learning loop both read', () => {
      const response = normaliseBriefResponse(brief, {
        briefId: brief.id,
        lines: [
          { id: 'X1', verdict: 'confirm' },
          {
            id: 'P2',
            verdict: 'correct',
            correction: 'Use the existing session rating',
          },
        ],
      })!;
      const text = renderBriefResponse(brief, response);
      expect(text).toContain(`[responds to situation brief ${brief.id}]`);
      expect(text).toContain('Confirmed: X1.');
      expect(text).toContain(
        'Corrected P2 ("A thumbs rating on the debrief"): Use the existing session rating',
      );
      expect(text).toContain('Not answered: X2, P1, R1, R2.');

      const forModel = renderBriefForModel(brief, response);
      expect(forModel).toContain(
        'X1 exists: Auto-improve tests challenger debrief prompts [CONFIRMED]',
      );
      expect(forModel).toContain(
        '[CORRECTED: Use the existing session rating]',
      );
      expect(forModel).toContain('apply every correction');
    });
  });
});
