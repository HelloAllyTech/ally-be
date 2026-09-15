import { buildVerificationComment } from '../verification-pr-comment.util';

const event = (type: string, payload: Record<string, any>) =>
  ({ type, payload }) as never;

/**
 * The run's own review, made visible on the pull request it cleared.
 *
 * Two properties carry the weight. Silence when there is nothing to report —
 * a comment that says "reviewed: nothing" on every pull request teaches people
 * to scroll past the one that matters. And the gate's trust line, because a
 * reviewer told "these tests pass" without being told the change rewrote the
 * test configuration has been misled by omission.
 */
describe('buildVerificationComment', () => {
  const sessionUrl = 'https://admin.example.com/builder/s1';

  it('says nothing when the run recorded nothing', () => {
    expect(
      buildVerificationComment({
        verification: null,
        gateResults: [],
        sessionUrl,
      }),
    ).toBeNull();
  });

  it('reports a clean review with what it checked', () => {
    const body = buildVerificationComment({
      verification: event('verification', {
        verdict: 'pass',
        objections: [],
        checkedRequirements: ['R1 reversal detection', 'R2 scorecard'],
      }),
      gateResults: [event('gate_result', { passed: true, trusted: true })],
      sessionUrl,
    })!;

    expect(body).toContain('fresh context');
    expect(body).toContain('R1 reversal detection');
    expect(body).toContain('did not modify the configuration');
    expect(body).toContain(sessionUrl);
  });

  /**
   * Objections the coder then fixed are the most useful thing here: they tell
   * a human what was nearly wrong, which a green diff cannot.
   */
  it('shows objections raised and addressed during the run', () => {
    const body = buildVerificationComment({
      verification: event('verification', {
        verdict: 'pass',
        objections: ['R2 had no tooltip', 'metric divided by the wrong cohort'],
        checkedRequirements: [],
      }),
      gateResults: [],
      sessionUrl,
    })!;

    expect(body).toContain('then addressed');
    expect(body).toContain('metric divided by the wrong cohort');
  });

  it('marks outstanding objections differently from resolved ones', () => {
    const body = buildVerificationComment({
      verification: event('verification', {
        verdict: 'fail',
        objections: ['R1 is not implemented'],
        checkedRequirements: [],
      }),
      gateResults: [],
      sessionUrl,
    })!;

    expect(body).toContain('Outstanding objections');
    expect(body).toContain('Read them before merging');
    expect(body).not.toContain('then addressed');
  });

  /**
   * The case the gate-trust work exists for: the suite passed, but in a tree
   * where the change edited what the suite does.
   */
  it('warns when the change edited the configuration that judges it', () => {
    const body = buildVerificationComment({
      verification: event('verification', {
        verdict: 'pass',
        objections: [],
        checkedRequirements: [],
      }),
      gateResults: [
        event('gate_result', {
          passed: true,
          trusted: false,
          configTouched: ['jest.config.js', 'package.json'],
        }),
      ],
      sessionUrl,
    })!;

    expect(body).toContain('not on its own evidence');
    expect(body).toContain('jest.config.js');
    expect(body).toContain('package.json');
  });

  it('does not claim a clean gate when one repo was untrusted', () => {
    const body = buildVerificationComment({
      verification: null,
      gateResults: [
        event('gate_result', { passed: true, trusted: true }),
        event('gate_result', {
          passed: true,
          trusted: false,
          configTouched: ['nx.json'],
        }),
      ],
      sessionUrl,
    })!;

    expect(body).toContain('nx.json');
    expect(body).not.toContain('did not modify the configuration');
  });

  /** An older runner sends no `trusted` flag; absence must not read as false. */
  it('treats a verdict with no trust flag as trusted', () => {
    const body = buildVerificationComment({
      verification: null,
      gateResults: [event('gate_result', { passed: true })],
      sessionUrl,
    })!;

    expect(body).toContain('did not modify the configuration');
  });
});
