import { buildBuildPrompt } from '../builder-build-prompt';
import { buildPlanPrompt } from '../builder-plan-prompt';
import { buildRemediatePrompt } from '../builder-remediate-prompt';
import { buildFinalisePrompt } from '../builder-finalise-prompt';
import { buildVerifyPrompt } from '../builder-verify-prompt';
import { buildFixPrompt } from '../builder-fix-prompt';
import { BUILDER_REPOS } from '../builder-repos.constants';
import { BuilderPrdDocument } from '../../type/builder-prd.type';

/**
 * The phase prompts are the contract between ally-be and the runner: the
 * runner fetches each one by URL and hands it straight to an engine. A prompt
 * that renders the wrong instructions is not a cosmetic bug — it is a build
 * that opens a PR at the wrong moment, or a remediation round that never
 * learns what it was meant to fix.
 */

const prd = {
  title: 'Comfort audio volume',
  summary: 'Let admins set per-simulation comfort-audio volume.',
  problem: 'Volume is fixed platform-wide.',
  usersAndContext: 'Platform admins configuring simulations.',
  goals: 'Per-sim control.',
  nonGoals: 'No per-user control.',
  requirements: [
    {
      id: 'R1',
      title: 'Volume field',
      description: 'A volume field on the simulation form.',
      acceptanceCriteria: ['Saving persists the value'],
    },
  ],
  assumptions: [],
  technicalPlan: {
    repos: [{ repo: 'ally-be', changesMd: 'Add the column.' }],
    dataModelMd: '',
    apiMd: '',
  },
  testPlanMd: 'Unit tests on the service.',
  e2ePlanMd: 'Set it in the admin UI and hear it.',
  openQuestions: [],
} as unknown as BuilderPrdDocument;

const repos = BUILDER_REPOS.filter((repo) => repo.repo === 'ally-be');

/**
 * Prompts are hard-wrapped prose, so a phrase that reads as one sentence is
 * often two lines in the source. Assert against the collapsed text: a test
 * that encodes where the line breaks fall fails on a reflow that changed
 * nothing a model reads.
 */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

const base = {
  sessionId: 'session-1',
  runId: 'run-1',
  branchSlug: 'comfort-audio-volume',
  prd,
  repos,
  apiBaseUrl: 'https://api.example.com',
};

describe('the coder prompt', () => {
  const render = (mode: 'build' | 'resume' = 'build') =>
    buildBuildPrompt({
      ...base,
      mode,
      sessionUrl: 'https://admin.example.com/builder/session-1',
      lessons: [],
    });

  it('tells the coder it does not open the pull requests', () => {
    // The old protocol had the coder open PRs at step 11 with verification
    // running afterwards, so a failing verdict failed a run whose PRs already
    // existed. If this instruction regresses, that behaviour comes back.
    const prompt = render();
    expect(flat(prompt)).toContain('You do not open the pull requests');
    expect(flat(prompt)).not.toContain('gh pr create');
  });

  it('stops the coder before pushing', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('do not push and do not open a PR');
    expect(flat(prompt)).toContain('Do not call `complete`');
  });

  it('mandates parallel subagents for parallel-safe workstreams', () => {
    const prompt = render();
    expect(flat(prompt)).toMatch(/concurrent `Task` subagents/);
    expect(flat(prompt)).toContain(
      'Never let two subagents hold the same file',
    );
  });

  it('still carries the pause contract', () => {
    // Pause-is-exit-0 is load-bearing across the whole pipeline; the phase
    // split must not have dropped it.
    const prompt = render();
    expect(flat(prompt)).toContain('**exit 0**');
    expect(flat(prompt)).toContain('"allowCustom": true');
  });

  it('tells a resume run to continue rather than restart', () => {
    const prompt = render('resume');
    expect(flat(prompt)).toContain('RESUME run');
    expect(flat(prompt)).toContain('Do NOT branch from master');
  });
});

describe('the coder prompt, on testing scope', () => {
  const render = () =>
    flat(
      buildBuildPrompt({
        ...base,
        mode: 'build',
        sessionUrl: 'https://admin.example.com/builder/session-1',
        lessons: [],
      }),
    );

  it('tells the coder not to run a whole repo suite', () => {
    // The first real build spent 20 of the coder's 33 minutes inside tool
    // calls, nearly all of it suites the gate then ran a second time. The gate
    // is not optional, so a full pass here is the same work twice.
    expect(render()).toMatch(/Do not run a whole repo's suite/i);
    expect(render()).toMatch(/the same work done twice/i);
  });

  it('names the narrowed alternatives rather than just forbidding the broad one', () => {
    const prompt = render();
    expect(prompt).toMatch(/blast radius/i);
    expect(prompt).toContain('affectedTest');
  });

  it('tells it to tail long output instead of carrying it in context', () => {
    expect(render()).toContain('tail -60');
  });

  it('no longer tells it to pre-empt the gate with a full run', () => {
    expect(render()).not.toMatch(
      /Run these yourself rather than leaving them to the gate/i,
    );
  });
});

describe('the plan prompt', () => {
  const render = () =>
    buildPlanPrompt({ ...base, lessons: ['[L-1] Migrations need a CHECK'] });

  it('asks for the workstream map the coder parallelises on', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('## Workstreams');
    expect(flat(prompt)).toContain('### Parallel-safe');
  });

  it('refuses to let overlapping file sets be called parallel-safe', () => {
    // A wrong "parallel-safe: yes" costs a merge conflict mid-run, so the
    // instruction has to be explicit about erring toward sequential.
    const prompt = render();
    expect(flat(prompt)).toContain('File sets must be genuinely disjoint');
    expect(flat(prompt)).toContain('When in doubt, say no');
  });

  it('tells the planner it cannot edit', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('You do not write the change');
  });

  it('carries lessons forward', () => {
    expect(flat(render())).toContain('[L-1] Migrations need a CHECK');
  });
});

describe('the remediate prompt', () => {
  const render = (overrides: Record<string, unknown> = {}) =>
    buildRemediatePrompt({
      ...base,
      round: 2,
      maxRounds: 4,
      gateFailures: [
        {
          repo: 'ally-be',
          kind: 'test',
          command: 'npm test',
          newFailures: ['src/comfort/comfort.service.spec.ts'],
          preExistingFailures: ['src/legacy/legacy.spec.ts'],
          outputTail: 'Expected 3, received undefined',
        },
      ],
      objections: [
        {
          severity: 'blocking',
          repo: 'ally-be',
          file: 'src/comfort/comfort.service.ts',
          summary: 'R1 has no test proving persistence',
          detail:
            'The new column is written but nothing asserts it round-trips.',
        },
      ],
      planMd: '## Approach\nAdd the column.',
      ...overrides,
    });

  it('shows the coder exactly what failed and what was objected to', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('src/comfort/comfort.service.spec.ts');
    expect(flat(prompt)).toContain('R1 has no test proving persistence');
    expect(flat(prompt)).toContain(
      'The reviewer’s objections'.replace('’', "'"),
    );
  });

  it('separates pre-existing failures from the ones this run caused', () => {
    // Fixing an unrelated red test inside a feature PR is a bad review, and
    // blaming the run for it is a false signal.
    const prompt = render();
    expect(flat(prompt)).toContain('src/legacy/legacy.spec.ts');
    expect(flat(prompt)).toContain('do not fix these here');
  });

  it('forbids the shortcuts that make a check pass without fixing anything', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('Never make a check pass by weakening it');
  });

  it('says how many attempts remain, and when it is the last', () => {
    expect(flat(render())).toContain('attempt 2 of 4');
    expect(flat(render({ round: 4 }))).toContain('This is the last attempt');
  });

  it('does not let the remediation round open a PR either', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('Do not push, do not open a PR');
  });
});

describe('the finalise prompt', () => {
  const render = () =>
    buildFinalisePrompt({
      ...base,
      sessionUrl: 'https://admin.example.com/builder/session-1',
      gateSummary: '- ally-be test (`npm test`): passed',
      verifierNotes: 'Consider caching later.',
      planMd: '## Approach\nAdd the column.',
    });

  it('is the only phase that opens pull requests', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('gh pr create');
    expect(flat(prompt)).toContain(
      'Opened by Builder — human review and merge required.',
    );
  });

  it('never merges and never touches master', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('Never run `gh pr merge`');
    expect(flat(prompt)).toContain('Never push to master');
  });

  it('carries the machine gate results into the PR body as evidence', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('- ally-be test (`npm test`): passed');
    expect(flat(prompt)).toContain(
      'the commands the gate ran and their results',
    );
  });

  it("surfaces the reviewer's accepted notes to the human reviewer", () => {
    expect(flat(render())).toContain('Consider caching later.');
  });

  it('asks for the lesson ids the run actually used', () => {
    // An unused lesson is one nobody should keep paying context for.
    expect(flat(render())).toContain('appliedLessonIds');
  });
});

describe('the fix prompt', () => {
  const render = (overrides: Record<string, unknown> = {}) =>
    buildFixPrompt({
      ...base,
      pullRequest: {
        repo: 'ally-be',
        branch: 'builder/comfort-audio-volume',
        prNumber: 42,
        prUrl: 'https://github.com/org/ally-be/pull/42',
        ciStatus: 'failure',
      },
      feedback: [
        {
          id: 'f-1',
          kind: 'ci_failure',
          author: 'ci',
          body: 'The check "unit tests" failed on abc1234.',
        },
        {
          id: 'f-2',
          kind: 'review_comment',
          author: 'a-reviewer',
          body: 'This needs a null check.',
          path: 'src/comfort/comfort.service.ts',
          line: 12,
        },
      ],
      attempt: 1,
      maxAttempts: 3,
      ...overrides,
    });

  it('names the pull request it is working on', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('ally-be#42');
    expect(flat(prompt)).toContain('builder/comfort-audio-volume');
  });

  it('lists each item with the id it must report back', () => {
    // An item left out stays pending and the next reconcile sends another fix
    // run at it, so the ids have to reach the agent.
    const prompt = render();
    expect(flat(prompt)).toContain('feedbackId: `f-1`');
    expect(flat(prompt)).toContain('feedbackId: `f-2`');
    expect(flat(prompt)).toContain('This needs a null check.');
    expect(flat(prompt)).toContain('src/comfort/comfort.service.ts:12');
  });

  it('allows disagreeing in writing, but not silence', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('They are mistaken');
    expect(flat(prompt)).toContain('silently ignoring a comment is not');
  });

  it('forbids rewriting history under a reviewer', () => {
    // A force-push destroys the reviewer's place in the diff and any comment
    // anchored to a line, and they will not know why.
    const prompt = render();
    expect(flat(prompt)).toContain('Never force-push. Never rebase.');
  });

  it('forbids weakening a check and forbids merging', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('Never weaken a check to make it pass');
    expect(flat(prompt)).toContain('never run `gh pr merge`');
  });

  it('keeps the fix inside the scope of the feedback', () => {
    const prompt = render();
    expect(flat(prompt)).toContain('Stay inside the scope of the feedback');
  });

  it('says which attempt this is', () => {
    expect(flat(render())).toContain('fix attempt 1 of 3');
  });
});

describe('the verify prompt', () => {
  it('tells the reviewer it is read-only', () => {
    const prompt = buildVerifyPrompt({ prd, repos, round: 1 });
    expect(flat(prompt)).toContain('**You are read-only.**');
    expect(flat(prompt)).toContain('Do not try to fix what you find');
  });

  it('threads the previous round objections into round two', () => {
    // This branch was dead before the verdict was persisted: every round
    // reviewed as if it were the first.
    const prompt = buildVerifyPrompt({
      prd,
      repos,
      round: 2,
      previousObjections: ['[blocking] ally-be · src/foo.ts R1 has no test'],
    });
    expect(flat(prompt)).toContain('This is round 2');
    expect(flat(prompt)).toContain('R1 has no test');
    expect(flat(prompt)).toContain('has since been re-invoked');
  });

  it('names symptom-suppression as a new finding rather than a fix', () => {
    const prompt = buildVerifyPrompt({
      prd,
      repos,
      round: 2,
      previousObjections: ['something'],
    });
    expect(flat(prompt)).toContain('a deleted test, a loosened');
  });

  it('hands over the gate results so the reviewer does not re-run suites', () => {
    const prompt = buildVerifyPrompt({
      prd,
      repos,
      round: 1,
      gateSummary: '- ally-be lint (`npm run lint`): passed',
    });
    expect(flat(prompt)).toContain('What the machine gate already checked');
    expect(flat(prompt)).toContain('- ally-be lint (`npm run lint`): passed');
  });

  it('omits the round note on a first round', () => {
    const prompt = buildVerifyPrompt({ prd, repos, round: 1 });
    expect(flat(prompt)).not.toContain('This is round');
  });
});
