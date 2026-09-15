import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderNotificationRepository } from '../repository/builder-build.repository';
import { BuilderNotificationKind } from '../enum/builder.enum';
import { SlackService } from 'src/notification/service/slack.service';
import { AppConfigService } from 'src/config/config.service';
import { BUILDER_ANNOUNCED_KINDS } from '../constants/builder.constants';

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

  constructor(
    private readonly repository: BuilderNotificationRepository,
    private readonly slack: SlackService,
    private readonly configService: AppConfigService,
  ) {}

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

    await this.announce(session, kind, message);
  }

  /**
   * Say it somewhere a person will see without going looking.
   *
   * The in-app inbox is a pull surface: it works only for someone already
   * looking at Builder, which is exactly who does not need telling. A build
   * paused on a question is indistinguishable from a build still working until
   * something says otherwise, and the docstring on this class has named that
   * as the worst failure mode since it was written — while every notification
   * stayed a database row nobody was pushed toward.
   *
   * Not every kind is worth interrupting for. A completed build is good news
   * that keeps; a question, a failure, a spend ceiling and a fix run touching
   * a pull request someone may be reviewing all have somebody waiting on the
   * other side. Announcing everything is how a channel gets muted, and a muted
   * channel is worse than no channel because it still looks like coverage.
   *
   * Best-effort after the row is written, never before, and never able to
   * throw: a Slack outage must not lose the notification or fail the thing it
   * was reporting on. The row is the record; this is the tap on the shoulder.
   */
  private async announce(
    session: BuilderSession,
    kind: BuilderNotificationKind,
    message: string,
  ): Promise<void> {
    if (!BUILDER_ANNOUNCED_KINDS.includes(kind)) return;
    try {
      const url = `${this.configService.adminBaseUrl}/builder/${session.id}`;
      await this.slack.sendMessage(
        `${message}\n${url}`,
        // Undefined means the platform default channel — SlackService's own
        // fallback, not a second one restated here.
        this.configService.builder.slackChannel,
      );
    } catch (error) {
      this.logger.warn(
        `Could not announce Builder notification (${kind}): ${
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

  /**
   * The one nobody can afford to miss.
   *
   * "Merged but not deployed" is worse than never having released: master has
   * moved on, the pull request reads as done, and everyone assumes the change
   * is live. On 2026-09-15 exactly this happened to an ally-be release — the
   * ECS circuit breaker rolled it back and prod silently served the previous
   * version for the better part of an hour. The whole point of watching a
   * release is to make that state impossible to sit in unnoticed.
   */
  releaseFailed(
    session: BuilderSession,
    repo: string,
    prNumber: number,
    tag: string | null,
    detail: string | null,
    runUrl: string | null,
  ): Promise<void> {
    return this.notify(
      session,
      BuilderNotificationKind.RELEASE_FAILED,
      `${repo}#${prNumber} is merged to master but is NOT deployed — release ${
        tag ?? 'dispatch'
      } failed${detail ? ` (${detail})` : ''}.${runUrl ? ` ${runUrl}` : ''}`,
    );
  }

  /**
   * Merged, and deliberately not released.
   *
   * Quieter than a failure and still worth saying: the change is on master and
   * waiting for someone to ship it, which nobody will do if nobody is told.
   */
  releaseSkipped(
    session: BuilderSession,
    repo: string,
    prNumber: number,
    why: string,
  ): Promise<void> {
    return this.notify(
      session,
      BuilderNotificationKind.RELEASE_SKIPPED,
      `${repo}#${prNumber} is merged but was not released automatically — ${why}. It needs a manual release.`,
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
