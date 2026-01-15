import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LoggerService } from 'src/logger/logger.service';
import { BadgeEvents } from '../constants/badge-event.constants';

@Injectable()
export class BadgeEventConsumer {
  private readonly logger = LoggerService.getInstance(BadgeEventConsumer.name);

  constructor() {}

  @OnEvent(BadgeEvents.BADGE_ASSIGNED_TO_TENANT, { async: true })
  async handleBadgeAssignedToTenant(payload: {
    badgeId: string;
    tenantId: string;
  }) {
    this.logger.info(
      `Processing badge ${payload.badgeId} for tenant ${payload.tenantId}`,
    );
    // TODO: Add handling here
  }
}
