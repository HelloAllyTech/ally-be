import { buildPromptHeader } from '../../constants/builder-build-prompt';

/**
 * The rule that cost a run.
 *
 * Run 9 of session 34d68cd2 fixed a migration collision, pushed it, and then
 * tried to WAIT for CI to confirm — sleeping, echoing, reaching for a
 * scheduling tool. Every waiting mechanism was refused by the sandbox, so
 * after 16 of its 24 turns and roughly $3.50 it gave up and ended its turn
 * without calling `complete`. `claude -p` exits 0 on `end_turn`, so the runner
 * could not tell that apart from success; the outcome gate caught it and
 * recorded a failure on a run whose work was already green.
 *
 * The rule belongs in the shared header rather than one prompt, because every
 * role can push and every role can be tempted to watch.
 */
describe('the shared prompt header', () => {
  const header = buildPromptHeader({
    sessionId: 's-1',
    runId: 'r-1',
    branchSlug: 'a-thing',
    apiBaseUrl: 'https://api.example.com',
    repos: [],
    role: 'coder',
  });

  it('tells the agent CI runs after the run, not during it', () => {
    expect(header).toContain('Never wait for CI');
    expect(header).toContain('after');
  });

  it('names the specific behaviours that burned the runner', () => {
    expect(header).toMatch(/sleep|poll/i);
    expect(header).toMatch(/background task/i);
  });

  /**
   * The consequence is the part that changes behaviour. "Do not wait" is
   * advice; "ending your turn without completing is recorded as a failure" is
   * a cost, and it is the true one.
   */
  it('states what happens if it stops without completing', () => {
    // `complete-run`, not `complete`: the latter is a bash builtin and can
    // never be invoked from a shell. See builder-agent-helpers.spec.
    expect(header).toMatch(
      /without calling .?complete-run.? is recorded as a run failure/i,
    );
    expect(header).toMatch(/circuit breaker/i);
  });

  it('points the agent at what actually handles a red CI', () => {
    expect(header).toMatch(/fix run/i);
  });
});
