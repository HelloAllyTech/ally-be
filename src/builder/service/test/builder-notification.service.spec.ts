import { BuilderNotificationService } from '../builder-notification.service';
import { BuilderNotificationKind } from '../../enum/builder.enum';

/**
 * The inbox is a pull surface — it works only for someone already looking at
 * Builder, which is exactly who does not need telling. Announcements are the
 * push half, and three things about them are load-bearing:
 *
 *  1. Only the kinds with a person waiting get announced. Announcing
 *     everything is how a channel gets muted, and a muted channel is worse
 *     than no channel because it still looks like coverage.
 *  2. Slack never decides whether the notification was recorded. The row is
 *     the record; the message is a tap on the shoulder.
 *  3. The link is built from the configured admin console, which is how this
 *     was found to be pointing at localhost in production.
 */
describe('BuilderNotificationService announcements', () => {
  const session = { id: 'sess-1', adminId: 7 } as any;

  const build = (over: Record<string, any> = {}) => {
    const repository = {
      create: (row: any) => row,
      save: jest.fn().mockResolvedValue({ id: 'n1' }),
      ...over.repository,
    };
    const slack = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    const config = {
      adminBaseUrl: 'https://admin.example.com',
      builder: { slackChannel: over.channel },
    };
    const service = new BuilderNotificationService(
      repository as never,
      slack as never,
      config as never,
    );
    return { service, repository, slack };
  };

  it('announces a pending question with a link back to the session', async () => {
    const { service, slack } = build();

    await service.questionPending(session, 2);

    expect(slack.sendMessage).toHaveBeenCalledTimes(1);
    const [text, channel] = slack.sendMessage.mock.calls[0];
    expect(text).toContain('https://admin.example.com/builder/sess-1');
    // Undefined means SlackService's own default channel — not a second
    // fallback restated here.
    expect(channel).toBeUndefined();
  });

  it('sends to the Builder channel when one is configured', async () => {
    const { service, slack } = build({ channel: '#builder' });

    await service.buildFailed(session, 'the gate never passed');

    expect(slack.sendMessage.mock.calls[0][1]).toBe('#builder');
  });

  /**
   * Good news that keeps. A completed build is in the inbox and does not
   * need to interrupt anyone.
   */
  it('does not announce a completed build', async () => {
    const { service, slack, repository } = build();

    await service.buildCompleted(session);

    expect(repository.save).toHaveBeenCalled();
    expect(slack.sendMessage).not.toHaveBeenCalled();
  });

  it('records the notification even when Slack is down', async () => {
    const { service, repository, slack } = build();
    slack.sendMessage.mockRejectedValue(new Error('slack 500'));

    await expect(service.questionPending(session, 1)).resolves.not.toThrow();
    expect(repository.save).toHaveBeenCalled();
  });

  /**
   * The promise auto-release was built on.
   *
   * "Merged but not deployed" reads as done from every angle — master has moved
   * on, the pull request is closed, CI is green — so the only thing that makes
   * it visible is the shout. Without this the watcher would write a row nobody
   * opens, and the feature would be worse than not releasing at all.
   */
  it('shouts when a merged pull request did not reach production', async () => {
    const { service, slack } = build();

    await service.releaseFailed(
      session,
      'ally-be',
      42,
      'v1.2.3',
      'failure',
      'https://run',
    );

    expect(slack.sendMessage).toHaveBeenCalled();
    expect(slack.sendMessage.mock.calls[0][0]).toContain('NOT deployed');
  });

  /** Merged and waiting on a person is not good news that keeps either. */
  it('announces a release it refused to guess at', async () => {
    const { service, slack } = build();

    await service.releaseSkipped(
      session,
      'ally-web',
      7,
      'it also changes shared code',
    );

    expect(slack.sendMessage).toHaveBeenCalled();
    expect(slack.sendMessage.mock.calls[0][0]).toContain('manual release');
  });

  it('only announces the kinds with someone waiting', async () => {
    const announced: BuilderNotificationKind[] = [];
    for (const [kind, call] of [
      [
        BuilderNotificationKind.QUESTION_PENDING,
        (s: any) => s.questionPending(session, 1),
      ],
      [
        BuilderNotificationKind.BUILD_COMPLETED,
        (s: any) => s.buildCompleted(session),
      ],
      [
        BuilderNotificationKind.BUILD_FAILED,
        (s: any) => s.buildFailed(session, 'x'),
      ],
    ] as const) {
      const { service, slack } = build();
      await call(service);
      if (slack.sendMessage.mock.calls.length) announced.push(kind);
    }

    expect(announced).toEqual([
      BuilderNotificationKind.QUESTION_PENDING,
      BuilderNotificationKind.BUILD_FAILED,
    ]);
  });
});

/**
 * Marking the inbox read.
 *
 * The bug these pin answered `{ ok: true }` while changing nothing: the
 * criteria said `readAt: null`, which TypeORM renders as `WHERE "readAt" =
 * NULL` — never true of any row. The endpoint reported success, the client
 * dutifully re-fetched, and the badge sat on fifty unread for days.
 *
 * A success response for work that did not happen is the failure mode nobody
 * investigates, so the assertion is on the criteria itself rather than on the
 * call merely having been made. A test that only checked "update was called"
 * would have passed against the broken version — which is roughly what the
 * client-side test shipped alongside the original bug did.
 */
describe('BuilderNotificationService marking read', () => {
  const build = () => {
    const repository = { update: jest.fn().mockResolvedValue(undefined) };
    const service = new BuilderNotificationService(
      repository as never,
      { sendMessage: jest.fn() } as never,
      { adminBaseUrl: 'https://admin.example.com', builder: {} } as never,
    );
    return { service, repository };
  };

  it('matches unread rows with IS NULL, not = NULL', async () => {
    const { service, repository } = build();

    await service.markAllRead(7);

    const [criteria] = repository.update.mock.calls[0];
    expect(criteria.adminId).toBe(7);
    // The shape TypeORM turns into `IS NULL`. A bare null here is the bug.
    expect(criteria.readAt).not.toBeNull();
    expect(String(criteria.readAt?.type ?? '')).toBe('isNull');
  });

  it('stamps a time rather than a flag, so "when" survives', async () => {
    const { service, repository } = build();

    await service.markAllRead(7);

    const [, patch] = repository.update.mock.calls[0];
    expect(patch.readAt).toBeInstanceOf(Date);
  });

  /** One notification is scoped by id AND owner: never another admin's row. */
  it('marks a single notification only for its own admin', async () => {
    const { service, repository } = build();

    await service.markRead('n-1', 7);

    const [criteria] = repository.update.mock.calls[0];
    expect(criteria).toEqual({ id: 'n-1', adminId: 7 });
  });
});
