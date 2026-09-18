import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InAppNotification } from '../entity/in-app-notification.entity';

export interface CreateInAppNotificationParams {
  userId: number;
  tenantId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

export interface ListNotificationsParams {
  limit: number;
  offset: number;
  unreadOnly: boolean;
}

@Injectable()
export class InAppNotificationService {
  constructor(
    @InjectRepository(InAppNotification)
    private readonly notificationRepository: Repository<InAppNotification>,
  ) {}

  async create(
    params: CreateInAppNotificationParams,
  ): Promise<InAppNotification> {
    const notification = this.notificationRepository.create({
      userId: params.userId,
      tenantId: params.tenantId,
      type: params.type,
      title: params.title,
      body: params.body,
      data: params.data ?? null,
    });
    return this.notificationRepository.save(notification);
  }

  async list(
    userId: number,
    { limit, offset, unreadOnly }: ListNotificationsParams,
  ): Promise<{ data: InAppNotification[]; count: number }> {
    const [data, count] = await this.notificationRepository.findAndCount({
      where: unreadOnly ? { userId, readAt: IsNull() } : { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, count };
  }

  async unreadCount(userId: number): Promise<number> {
    return this.notificationRepository.count({
      where: { userId, readAt: IsNull() },
    });
  }

  /** Scoped to `userId` so a caller can never mark another user's notification read. */
  async markRead(userId: number, id: string): Promise<boolean> {
    const result = await this.notificationRepository.update(
      { id, userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }

  async markAllRead(userId: number): Promise<boolean> {
    await this.notificationRepository.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return true;
  }
}
