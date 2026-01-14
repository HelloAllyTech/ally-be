import { Injectable } from '@nestjs/common';
import { BadgeRepository } from '../repository/badge.repository';
import { UserBadgeResponse } from '../constants/badge-response.constants';
import { BadgeViewedStatus } from '../constants/badge.constants';

@Injectable()
export class BadgeService {
  constructor(private readonly badgeRepository: BadgeRepository) {}

  async getUserBadges(
    userId: number,
    viewedStatus?: BadgeViewedStatus,
  ): Promise<UserBadgeResponse> {
    const badges = await this.badgeRepository.getUserBadges(
      userId,
      viewedStatus,
    );
    return {
      data: badges,
    };
  }
}
