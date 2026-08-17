import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, Repository } from 'typeorm';

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

  markAllRead(userId: number): Promise<unknown> {
    return this.update(
      { readAt: IsNull() },
      { readAt: new Date(), readBy: userId },
    );
  }
}
