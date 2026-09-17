import { BadRequestException } from '@nestjs/common';

import { BuilderPullRequestService } from '../builder-pull-request.service';
import { BuilderQuestionService } from '../builder-question.service';

/**
 * A pause stops the build until a person answers it, so a question with
 * nothing in it is worse than no question at all.
 *
 * The prompt used to fall back to a fabricated placeholder — "The agent needs a
 * decision." — and the session parked on it. Nobody can answer that, and a
 * parked run counts as an active one, so every later fix and review dispatch
 * for the session was refused in silence. One empty `ask` cost a session four
 * hours, and the person looking at it had no way to know what was being asked.
 */
describe('BuilderQuestionService.recordPause — a question must say something', () => {
  const service = () => {
    const svc = Object.create(
      BuilderQuestionService.prototype,
    ) as BuilderQuestionService;
    Object.assign(svc, {
      questionRepository: {
        save: jest.fn(async (row: unknown) => row),
        create: jest.fn((row: unknown) => row),
      },
      runRepository: { update: jest.fn() },
      sessionRepository: {
        update: jest.fn(),
        // Read after the pause lands, to address the notification.
        findOne: jest.fn().mockResolvedValue({ id: 's-1', title: 'a build' }),
      },
      eventService: { record: jest.fn() },
      notificationService: { questionPending: jest.fn() },
      logger: { info: jest.fn(), warn: jest.fn() },
    });
    return svc as any;
  };

  const run = { id: 'run-1', sessionId: 's-1', branches: null };

  it('refuses a pause whose question has an empty prompt', async () => {
    await expect(
      service().recordPause(run, [{ prompt: '   ' }], null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a pause with no prompt field at all', async () => {
    await expect(
      service().recordPause(run, [{ kind: 'freeText' }], null),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /**
   * Refusing the call leaves the run alive so the agent can ask again with
   * something in it. Parking on an unanswerable question is what is not
   * recoverable, so the run must NOT be marked waiting on the way out.
   */
  it('leaves the run untouched when it refuses', async () => {
    const svc = service();

    await expect(
      svc.recordPause(run, [{ prompt: '' }], null),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.runRepository.update).not.toHaveBeenCalled();
    expect(svc.sessionRepository.update).not.toHaveBeenCalled();
  });

  /** One good question among bad ones still refuses: the pause is the unit. */
  it('refuses the whole pause when only one question is empty', async () => {
    await expect(
      service().recordPause(
        run,
        [{ prompt: 'Which database?' }, { prompt: '' }],
        null,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a pause whose questions all say something', async () => {
    const svc = service();

    const saved = await svc.recordPause(
      run,
      [{ prompt: 'Which database should this write to?' }],
      { 'ally-be': 'builder/x' },
    );

    expect(saved).toHaveLength(1);
    expect(svc.runRepository.update).toHaveBeenCalled();
  });
});

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
