import { BuilderPullRequestService } from '../builder-pull-request.service';

/**
 * A credential that stops working must say so.
 *
 * An expired token does not announce itself: every call comes back
 * unauthorised, each caller catches its own failure and logs a warning, and the
 * scheduled tasks above them keep reporting that they completed. The platform
 * goes quiet while looking healthy. One expiry cost most of a day, found only
 * by reading the right log line by hand.
 */
describe('BuilderPullRequestService.reportCredentialHealth', () => {
  const build = (health: { failures: number; since: Date | null }) => {
    const notificationService = { credentialRejected: jest.fn() };
    const svc = Object.create(
      BuilderPullRequestService.prototype,
    ) as BuilderPullRequestService;
    Object.assign(svc, {
      github: { credentialHealth: health },
      sessionRepository: {
        findOne: jest.fn().mockResolvedValue({ id: 's-1' }),
      },
      notificationService,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
    return { svc: svc as any, notificationService };
  };

  const since = new Date('2026-09-16T13:22:00.000Z');

  it('raises the alarm once the failures are a credential, not a permission', async () => {
    const { svc, notificationService } = build({ failures: 5, since });

    await svc.reportCredentialHealth();

    expect(notificationService.credentialRejected).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-1' }),
      5,
      since,
    );
  });

  /**
   * A fine-grained token can legitimately be refused one repository — an
   * allowlist miss, or a grant pending org approval. Crying credential over
   * that trains people to ignore the message.
   */
  it('stays quiet about a single rejection', async () => {
    const { svc, notificationService } = build({ failures: 1, since });

    await svc.reportCredentialHealth();

    expect(notificationService.credentialRejected).not.toHaveBeenCalled();
  });

  it('stays quiet when the credential is working', async () => {
    const { svc, notificationService } = build({ failures: 0, since: null });

    await svc.reportCredentialHealth();

    expect(notificationService.credentialRejected).not.toHaveBeenCalled();
  });
});
