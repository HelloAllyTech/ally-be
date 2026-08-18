import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';

import { BugHunterNotification } from '../entity/bug-hunter-notification.entity';

@Injectable()
export class BugHunterNotificationRepository extends Repository<BugHunterNotification> {
  constructor(dataSource: DataSource) {
    super(BugHunterNotification, dataSource.createEntityManager());
  }

  /**
   * Newest first, unread and read together.
   *
   * Deliberately NOT unread-only by default: an admin coming back to the tab
   * needs to see what happened while they were away, not just what nobody has
   * clicked yet. The unread count is what draws the eye; the list is the log.
   */
  async listRecent(
    limit: number,
    unreadOnly: boolean,
  ): Promise<{ items: BugHunterNotification[]; unreadCount: number }> {
    const [items, unreadCount] = await Promise.all([
      this.find({
        where: unreadOnly ? { readAt: IsNull() } : {},
        order: { createdAt: 'DESC' },
        take: limit,
      }),
      this.count({ where: { readAt: IsNull() } }),
    ]);
    return { items, unreadCount };
  }

  /**
   * Whether a notification with this exact title has been raised since `since`.
   *
   * Used to keep the stale-question digest to once a day. Matching on title is
   * crude, but this table has no metadata column to mark a digest with, and
   * adding one for a single boolean would be a migration for nothing. The title
   * is a constant (`STALE_ESCALATION_DIGEST_TITLE`) precisely so this holds.
   */
  async existsWithTitleSince(title: string, since: Date): Promise<boolean> {
    const count = await this.count({
      where: { title, createdAt: MoreThan(since) },
    });
    return count > 0;
  }

  markAllRead(userId: number): Promise<unknown> {
    return this.update(
      { readAt: IsNull() },
      { readAt: new Date(), readBy: userId },
    );
  }
}
