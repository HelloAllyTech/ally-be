import {
  BugHunterMessage,
  findingReleased,
  findingReleaseFailed,
  needsYourAnswer,
  planCreated,
  planReadyToRelease,
  planReleased,
  planReleaseStopped,
  planStepFailed,
  planStepNeedsAnswer,
  runFailed,
  runFoundBugs,
  stuckOnRepo,
} from '../bug-hunter-voice';

const totals = {
  foundCount: 3,
  autoMergedCount: 1,
  prOpenedCount: 2,
  dismissedCount: 0,
};

/** Every message the module can produce, with plausible arguments. */
const everyMessage = (): BugHunterMessage[] => [
  needsYourAnswer('Terms link 404s', 'Which field name should I use?'),
  stuckOnRepo('ally-be', 'local tests still red after 2 attempts'),
  runFailed('ally-be', totals, '0.4200'),
  runFoundBugs('ally-be', totals, '0.4200'),
  planCreated('Terms link 404s', ['ally-be', 'ally-web']),
  planReadyToRelease('Terms link 404s', ['ally-be', 'ally-web']),
  planStepNeedsAnswer('Terms link 404s', 0, 'ally-be', 'Which field name?'),
  planStepFailed('Terms link 404s', 1, 'ally-web'),
  planReleaseStopped('Terms link 404s', 1, 'ally-web'),
  planReleased('Terms link 404s', [
    { repo: 'ally-be', releaseTag: 'v1.4.2' },
    { repo: 'ally-web', releaseTag: 'v2.0.1' },
  ]),
  findingReleased('Terms link 404s', 'v1.4.2', 'ally-be'),
  findingReleaseFailed('Terms link 404s', 'v1.4.2', 'ally-be', 'migration'),
];

describe('bug-hunter voice', () => {
  // The whole reason this module exists. A message *from* Bug Hunter that
  // narrates Bug Hunter in the third person reads as someone else's status
  // report, and the inbox is meant to be the agent speaking for itself.
  it('never refers to itself by name', () => {
    for (const message of everyMessage()) {
      expect(`${message.title} ${message.body ?? ''}`).not.toContain(
        'Bug Hunter',
      );
    }
  });

  it('speaks in the first person', () => {
    for (const message of everyMessage()) {
      expect(`${message.title} ${message.body ?? ''}`).toMatch(
        /\b(I|I'm|I'll|I've|my|me)\b/i,
      );
    }
  });

  it('stays plain — no exclamation marks, no emoji', () => {
    for (const message of everyMessage()) {
      const text = `${message.title} ${message.body ?? ''}`;
      expect(text).not.toContain('!');
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('numbers plan steps the way a person would, from one', () => {
    expect(planStepFailed('Terms link 404s', 0, 'ally-be').title).toContain(
      'step 1',
    );
    expect(planReleaseStopped('Terms link 404s', 2, 'ally-ai').title).toContain(
      'step 3',
    );
  });

  it('names the repos in the order they have to ship', () => {
    expect(planCreated('x', ['ally-be', 'ally-web', 'ally-ai']).body).toContain(
      'ally-be → ally-web → ally-ai',
    );
  });

  it('says a repo is unassigned rather than printing null at someone', () => {
    expect(planCreated('x', ['ally-be', null]).body).toContain(
      'an unassigned repo',
    );
  });

  it('agrees its plural when a sweep found exactly one bug', () => {
    expect(
      runFoundBugs('ally-be', { ...totals, foundCount: 1 }, '0').title,
    ).toBe('I found 1 bug in ally-be');
    expect(
      runFoundBugs('ally-be', { ...totals, foundCount: 2 }, '0').title,
    ).toBe('I found 2 bugs in ally-be');
  });

  it('falls back to its own words when a step stopped without recording a question', () => {
    expect(planStepNeedsAnswer('x', 0, 'ally-be', null).body).toMatch(
      /answer/i,
    );
  });

  // The distinction the admin acts on: a red deploy is not a lost fix, and
  // saying so is what stops someone re-doing work that is already on master.
  it('is explicit that a failed release leaves the fix merged', () => {
    const message = findingReleaseFailed('x', 'v1.4.2', 'ally-be', 'migration');
    expect(message.body).toContain('still merged to master');
    expect(message.body).toContain('NOT deployed');
  });

  it('claims production only once something is actually in production', () => {
    expect(findingReleased('x', 'v1.4.2', 'ally-be').title).toContain(
      'live in production',
    );
    expect(
      planReleased('x', [{ repo: 'ally-be', releaseTag: 'v1' }]).title,
    ).toContain('live in production');
  });
});
