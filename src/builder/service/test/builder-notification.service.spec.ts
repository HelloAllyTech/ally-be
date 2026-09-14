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
