import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { Badge } from '../entity/badge.entity';
import { BadgeTenant } from '../entity/badge-tenant.entity';
import { BadgeStatus, BadgeVisibilityType } from '../constants/badge.constants';

@Injectable()
export class BadgeTenantSharedService {
  private static readonly logger = LoggerService.getInstance(
    BadgeTenantSharedService.name,
  );

  constructor() {}

  async addPublicBadgesToTenant(
    tenantId: string,
    entityManager: EntityManager,
  ): Promise<boolean> {
    const badgeRepository = entityManager.getRepository(Badge);
    const badgeTenantRepository = entityManager.getRepository(BadgeTenant);

    const publicBadges = await badgeRepository.find({
      where: {
        visibilityType: BadgeVisibilityType.PUBLIC,
        status: BadgeStatus.ACTIVE,
      },
    });

    if (publicBadges.length === 0) {
      BadgeTenantSharedService.logger.warn(
        'No public badges found to assign to tenant',
      );
      return false;
    }

    const badgeTenantMappings = publicBadges.map((badge) => ({
      badgeId: badge.id,
      tenantId,
    }));

    await badgeTenantRepository.insert(badgeTenantMappings);

    return true;
  }
}
