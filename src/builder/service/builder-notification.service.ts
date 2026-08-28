import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderNotificationRepository } from '../repository/builder-build.repository';
import { BuilderNotificationKind } from '../enum/builder.enum';

/**
 * What happened while the admin was elsewhere.
 *
 * A backgrounded agent's worst failure is silence: a build blocked on an
 * unanswered question looks exactly like a build still working unless
 * something says otherwise. Every method here marks a moment where the
 * session either stopped being able to progress on its own, or finished.
 *
 * Messages are written whole, in the agent's voice, rather than assembled
 * client-side from a kind and some ids — the inbox and a push both need the
 * same sentence, and templating it twice is how they drift.
 */
@Injectable()
export class BuilderNotificationService {
  private readonly logger = LoggerService.getInstance(
    BuilderNotificationService.name,
  );

  constructor(private readonly repository: BuilderNotificationRepository) {}

  private async notify(
    session: BuilderSession,
    kind: BuilderNotificationKind,
    message: string,
  ): Promise<void> {
    try {
      await this.repository.save(
        this.repository.create({
          adminId: session.createdBy,
          sessionId: session.id,
          kind,
          message,
        }),
      );
    } catch (error) {
      // Never let a notification failure break the thing it is reporting on.
      this.logger.warn(
        `Could not record Builder notification (${kind}) for session ${session.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  questionPending(session: BuilderSession, count: number): Promise<void> {
    return this.notify(
      session,
      BuilderNotificationKind.QUESTION_PENDING,
      count === 1
        ? `I've paused “${session.title}” — I need one answer before I can carry on.`
        : `I've paused “${session.title}” — I need ${count} answers before I can carry on.`,
    );
  }

  buildCompleted(session: BuilderSession): Promise<void> {
    return this.notify(
      session,
      BuilderNotificationKind.BUILD_COMPLETED,
      `“${session.title}” is done.`,
    );
  }

  buildFailed(session: BuilderSession, error: string | null): Promise<void> {
    return this.notify(
      session,
      BuilderNotificationKind.BUILD_FAILED,
      `“${session.title}” stopped: ${error ?? 'the build failed.'}`,
    );
  }

  prsOpened(session: BuilderSession, count: number): Promise<void> {
    return this.notify(
      session,
      BuilderNotificationKind.PRS_OPENED,
      count === 1
        ? `“${session.title}” has a pull request open for review.`
        : `“${session.title}” has ${count} pull requests open for review.`,
    );
  }

  /**
   * A fix run went out at a pull request. Worth telling someone: Builder is
   * pushing to a branch a human may be reading right now, and finding that out
   * from the commit list rather than from us is a bad surprise.
   */
  fixRunStarted(
    session: BuilderSession,
    repo: string,
    prNumber: number,
    reason: string,
  ): Promise<void> {
    return this.notify(
      session,
      BuilderNotificationKind.FIX_RUN_STARTED,
      `Builder is working on ${repo}#${prNumber} — ${reason}.`,
    );
  }

  budgetReached(session: BuilderSession, spent: number): Promise<void> {
    return this.notify(
      session,
      BuilderNotificationKind.BUDGET_REACHED,
      `“${session.title}” has reached its $${spent.toFixed(2)} budget and won't start more work until you raise it.`,
    );
  }

  /**
   * The urgent version of the above: a run is holding its work open, waiting.
   *
   * Separate from `budgetReached` because the deadline is the whole message.
   * "Reached its budget" is something to deal with later; this one expires, and
   * what expires with it is an hour of coding that was never pushed anywhere.
   */
  budgetHold(
    session: BuilderSession,
    spent: number,
    holdMinutes: number,
  ): Promise<void> {
    return this.notify(
      session,
      BuilderNotificationKind.BUDGET_REACHED,
      `“${session.title}” has paused mid-build at $${spent.toFixed(2)} — its ceiling is gone. ` +
        `Raise the budget within ${holdMinutes} minutes and it carries on from where it stopped; ` +
        'after that it gives up and the work in progress is lost.',
    );
  }

  listForAdmin(adminId: number, unreadOnly = false) {
    return this.repository.listForAdmin(adminId, unreadOnly);
  }

  countUnread(adminId: number): Promise<number> {
    return this.repository.countUnread(adminId);
  }

  async markRead(id: string, adminId: number): Promise<void> {
    await this.repository.update({ id, adminId }, { readAt: new Date() });
  }

  async markAllRead(adminId: number): Promise<void> {
    await this.repository.update(
      { adminId, readAt: null as any },
      { readAt: new Date() },
    );
  }
}
