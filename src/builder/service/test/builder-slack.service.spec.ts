import { BuilderSlackService } from '../builder-slack.service';

/**
 * Who is allowed to ship to production from a chat message.
 *
 * The button is a convenience; this is the part where being wrong means anyone
 * ever invited to a Slack channel can merge to master and deploy. Every test
 * here is a way in that has to stay shut.
 */
describe('BuilderSlackService', () => {
  const prRow = (over: Record<string, any> = {}) => ({
    id: 'pr-1',
    sessionId: 'session-1',
    repo: 'ally-be',
    prNumber: 42,
    merged: false,
    ...over,
  });

  const build = (approvers: string[] = ['U-APPROVER']) => {
    const pullRequestService = {
      mergePullRequest: jest.fn().mockResolvedValue({ merged: true }),
    };
    const pullRequestRepository = {
      findOne: jest.fn().mockResolvedValue(prRow()),
    };
    const service = new BuilderSlackService(
      { builder: { slackApprovers: approvers } } as never,
      pullRequestService as never,
      pullRequestRepository as never,
    );
    return { service, pullRequestService, pullRequestRepository };
  };

  const click = (userId: string | undefined, value = 'pr-1') => ({
    user: userId ? { id: userId } : undefined,
    actions: [{ action_id: 'builder_merge', value }],
  });

  it('merges for someone on the approver list', async () => {
    const { service, pullRequestService } = build();

    const result = await service.handleInteraction(click('U-APPROVER'));

    expect(pullRequestService.mergePullRequest).toHaveBeenCalledWith(
      'session-1',
      'pr-1',
      0,
    );
    expect(result.text).toContain('Merged ally-be#42');
  });

  it('refuses someone who is not on the list', async () => {
    const { service, pullRequestService } = build();

    const result = await service.handleInteraction(click('U-RANDOM'));

    expect(pullRequestService.mergePullRequest).not.toHaveBeenCalled();
    expect(result.text).toContain('approver list');
  });

  /**
   * Deny by default. An unset allowlist means nobody, not everybody — the
   * opposite reading turns a missing config value into an open door.
   */
  it('refuses everyone when no approvers are configured', async () => {
    const { service, pullRequestService } = build([]);

    const result = await service.handleInteraction(click('U-APPROVER'));

    expect(pullRequestService.mergePullRequest).not.toHaveBeenCalled();
    expect(result.text).toContain('approver list');
  });

  it('refuses a payload with no user at all', async () => {
    const { service, pullRequestService } = build();

    await service.handleInteraction(click(undefined));

    expect(pullRequestService.mergePullRequest).not.toHaveBeenCalled();
  });

  /**
   * The button carries our own row id and this looks it up. Trusting a
   * repo/number pair out of the payload would let a request name any pull
   * request in any repo.
   */
  it('refuses an id that is not a pull request we announced', async () => {
    const { service, pullRequestService, pullRequestRepository } = build();
    pullRequestRepository.findOne.mockResolvedValue(null);

    const result = await service.handleInteraction(
      click('U-APPROVER', 'made-up'),
    );

    expect(pullRequestService.mergePullRequest).not.toHaveBeenCalled();
    expect(result.text).toContain("can't find");
  });

  it('says so rather than merging twice', async () => {
    const { service, pullRequestService, pullRequestRepository } = build();
    pullRequestRepository.findOne.mockResolvedValue(prRow({ merged: true }));

    const result = await service.handleInteraction(click('U-APPROVER'));

    expect(pullRequestService.mergePullRequest).not.toHaveBeenCalled();
    expect(result.text).toContain('already merged');
  });

  /**
   * The merge service refuses by throwing, and its messages are written for a
   * person — relaying them beats inventing a worse sentence, and none of them
   * is a reason to retry with force.
   */
  it('relays why the merge was refused', async () => {
    const { service, pullRequestService } = build();
    pullRequestService.mergePullRequest.mockRejectedValue(
      new Error('Checks are not green on this pull request.'),
    );

    const result = await service.handleInteraction(click('U-APPROVER'));

    expect(result.text).toContain('Checks are not green');
  });

  it('acknowledges a link button without commenting', async () => {
    const { service, pullRequestService } = build();

    const result = await service.handleInteraction({
      user: { id: 'U-APPROVER' },
      actions: [{ action_id: 'builder_open_pr', value: 'pr-1' }],
    });

    expect(result.text).toBe('');
    expect(pullRequestService.mergePullRequest).not.toHaveBeenCalled();
  });

  it('ignores an action it does not recognise', async () => {
    const { service, pullRequestService } = build();

    await service.handleInteraction({
      user: { id: 'U-APPROVER' },
      actions: [{ action_id: 'something_else', value: 'pr-1' }],
    });

    expect(pullRequestService.mergePullRequest).not.toHaveBeenCalled();
  });
});
