import { Injectable, NotFoundException } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';

import { BugHunterNotification } from '../entity/bug-hunter-notification.entity';
import { BugHunterNotificationRepository } from '../repository/bug-hunter-notification.repository';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';

export interface NotifyParams {
  level: BugHunterNotificationLevel;
  title: string;
  body?: string;
  findingId?: string | null;
  runId?: string | null;
  repo?: string | null;
}

/**
 * Everything Bug Hunter has to say to an admin, in one place: the inbox at the
 * top of the Bug Hunter tab.
 *
 * This replaced the module's Slack posts outright — escalations, run
 * summaries and release outcomes used to go to the platform Slack channel via
 * NotificationService, and those three methods were deleted along with this
 * change. One channel, one place to look, nothing to keep in sync.
 *
 * ## What earns a notification
 *
 * Not every event. `bug_hunt_events` is the full transcript — every finder
 * result, every fix attempt — and most of it is only interesting when you go
 * looking. A notification is the much smaller set worth pulling someone's
 * attention to, which in practice is: Bug Hunter is stuck and needs an answer;
 * something went wrong; or something reached production. A quiet, successful
 * night still produces nothing, exactly as it did when this was Slack.
 *
 * That split is the point of the three levels (see BugHunterNotificationLevel):
 * only ACTION_NEEDED drives the unread badge's urgency, because only that one
 * means work is blocked on a human. Stacks' "Balancing Proactive Agent
 * Engagement Without Intrusion" is the same idea — proactive messages have to
 * clear a relevance bar or they train people to ignore the channel.
 */
@Injectable()
export class BugHunterNotificationService {
  private readonly logger = LoggerService.getInstance(
    BugHunterNotificationService.name,
  );

  constructor(private readonly repository: BugHunterNotificationRepository) {}

  /**
   * Records one notification.
   *
   * Never throws: this is told about things that already happened, and a
   * failure to write the note must not roll back the fix, the release, or the
   * status transition that prompted it. Same best-effort contract as
   * BugHunterService.snapshotCostUsd.
   */
  async notify(params: NotifyParams): Promise<void> {
    try {
      await this.repository.save(
        this.repository.create({
          level: params.level,
          title: params.title,
          body: params.body ?? null,
          findingId: params.findingId ?? null,
          runId: params.runId ?? null,
          repo: params.repo ?? null,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Could not record Bug Hunter notification "${params.title}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  list(
    limit = 50,
    unreadOnly = false,
  ): Promise<{ items: BugHunterNotification[]; unreadCount: number }> {
    return this.repository.listRecent(limit, unreadOnly);
  }

  /** Whether this exact message has already gone out since `since` — see the digest's dedup note. */
  wasRaisedSince(title: string, since: Date): Promise<boolean> {
    return this.repository.existsWithTitleSince(title, since);
  }

  async markRead(id: string, userId: number): Promise<BugHunterNotification> {
    const notification = await this.repository.findOne({ where: { id } });
    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    // Idempotent: re-reading keeps the first reader and the first timestamp,
    // so "who dealt with this" doesn't get overwritten by whoever opened the
    // tab next.
    if (notification.readAt) return notification;

    await this.repository.update(id, { readAt: new Date(), readBy: userId });
    return (await this.repository.findOne({ where: { id } }))!;
  }

  async markAllRead(userId: number): Promise<{ unreadCount: number }> {
    await this.repository.markAllRead(userId);
    return { unreadCount: 0 };
  }
}
