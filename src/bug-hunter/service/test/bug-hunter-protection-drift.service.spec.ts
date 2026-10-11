import {
  BugHunterProtectionDriftService,
  problemsFor,
} from '../bug-hunter-protection-drift.service';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHunterNotificationLevel } from '../../enum/bug-hunter-notification.enum';

const protection = (reviews: number, checks: string[] = ['Jest']) => ({
  reviewsRequired: reviews,
  requiredChecks: checks,
  source: 'ruleset' as const,
});

describe('problemsFor', () => {
  it('flags a not-bot-mergeable repo that no longer requires a review, and a bot-mergeable one that does', () => {
    expect(problemsFor('ally-be', false, protection(0))).toEqual([
      expect.stringContaining('no review is required any more'),
    ]);
    expect(problemsFor('ally-ai-learn', true, protection(1))).toEqual([
      expect.stringContaining('now requires 1 approving review'),
    ]);
    expect(problemsFor('ally-ai', false, protection(1, ['gitleaks']))).toEqual(
      [],
    );
    expect(problemsFor('ally-ai-learn', true, protection(0, []))).toEqual([
      expect.stringContaining('No status check is required'),
    ]);
  });
});

describe('BugHunterProtectionDriftService', () => {
  const build = (
    byRepo: Record<string, ReturnType<typeof protection> | null>,
    previous: Record<string, unknown> | null,
  ) => {
    const saved: unknown[] = [];
    const notify = jest.fn();
    const service = new BugHunterProtectionDriftService(
      {
        getBranchProtection: jest
          .fn()
          .mockImplementation((repo: string) =>
            Promise.resolve(byRepo[repo] ?? null),
          ),
      } as never,
      { notify } as never,
      {
        find: jest.fn().mockResolvedValue(
          previous
            ? [
                {
                  stage: BugHuntEventStage.SETTINGS_CHANGED,
                  payload: { kind: 'protection_snapshot', snapshot: previous },
                },
              ]
            : [],
        ),
        create: jest.fn().mockImplementation((v) => v),
        save: jest.fn().mockImplementation((v) => {
          saved.push(v);
          return Promise.resolve(v);
        }),
      } as never,
    );
    return { service, notify, saved };
  };

  it('raises one Problem per drifted repo the first time, writes a snapshot, and stays quiet while nothing changes', async () => {
    const live = {
      'ally-be': protection(0, ['Jest', 'Typecheck']),
      'ally-web': protection(0, ['Vitest']),
      'ally-ai': protection(1, ['gitleaks']),
      'ally-ai-learn': protection(0, ['pytest']),
      'ally-mobile': protection(0, ['Jest']),
    };
    const first = build(live, null);
    const drifts = await first.service.run();
    expect(drifts.filter((d) => d.problems.length).map((d) => d.repo)).toEqual([
      'ally-be',
      'ally-web',
      'ally-mobile',
    ]);
    expect(first.notify).toHaveBeenCalledTimes(3);
    expect(first.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        level: BugHunterNotificationLevel.PROBLEM,
        repo: 'ally-be',
        title: expect.stringContaining('ally-be'),
        body: expect.stringContaining(
          '0 reviews required, checks Jest, Typecheck',
        ),
      }),
    );
    const snapshot = (
      first.saved[0] as { payload: { snapshot: Record<string, unknown> } }
    ).payload.snapshot;
    expect(snapshot['ally-be']).toMatchObject({
      reviewsRequired: 0,
      problems: 1,
    });

    // Same state next night: no new notice.
    const second = build(live, snapshot);
    await second.service.run();
    expect(second.notify).not.toHaveBeenCalled();

    // Protection restored on ally-be: the state changed, but there is no
    // problem to report, so still no notice — the snapshot just moves on.
    const third = build(
      { ...live, 'ally-be': protection(1, ['Jest']) },
      snapshot,
    );
    await third.service.run();
    expect(third.notify).not.toHaveBeenCalled();
  });

  it('skips a repo GitHub could not answer for rather than calling it unprotected', async () => {
    const { service, notify } = build({ 'ally-ai-learn': protection(0) }, null);
    const drifts = await service.run();
    expect(drifts.map((d) => d.repo)).toEqual(['ally-ai-learn']);
    expect(notify).not.toHaveBeenCalled();
  });
});
