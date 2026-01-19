import { In, Repository } from 'typeorm';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BadgeTenant } from '../entity/badge-tenant.entity';
import { TenantsRepository } from 'src/tenant/repository/tenant.repository';
import { Badge } from '../entity/badge.entity';
import { BadgeStatus, BadgeVisibilityType } from '../constants/badge.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BadgeTenantService {
  constructor(
    @InjectRepository(BadgeTenant)
    private readonly badgeTenantRepository: Repository<BadgeTenant>,
    private readonly tenantsRepository: TenantsRepository,
    @InjectRepository(Badge)
    private readonly badgeRepository: Repository<Badge>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async addBadgeToTenants(
    badgeId: string,
    tenantIds: string[],
  ): Promise<boolean> {
    const badge = await this.badgeRepository.findOne({
      where: { id: badgeId },
    });
    if (!badge) {
      throw new NotFoundException('Badge not found');
    }
    if (badge.status !== BadgeStatus.ACTIVE) {
      throw new BadRequestException('Badge is not active');
    }
    const badgeTenants: BadgeTenant[] = [];

    const uniqueTenantIds = Array.from(new Set(tenantIds));
    const tenants = await this.tenantsRepository.find({
      where: { id: In(uniqueTenantIds) },
    });
    if (tenants.length !== uniqueTenantIds.length) {
      throw new NotFoundException('Some tenants do not exist');
    }

    const existingMappings = await this.badgeTenantRepository.find({
      where: { badgeId, tenantId: In(uniqueTenantIds) },
    });

    const tenantIdsToAdd = uniqueTenantIds.filter(
      (id) => !existingMappings?.some((m) => m.tenantId === id),
    );
    for (const tenantId of tenantIdsToAdd) {
      const badgeTenant = this.badgeTenantRepository.create({
        badgeId,
        tenantId,
      });
      badgeTenants.push(badgeTenant);
    }

    if (badgeTenants.length > 0) {
      await this.badgeTenantRepository.save(badgeTenants);
      // TODO: Call function to evaluate and award badge for each tenant users
    }

    return true;
  }

  async removeBadgeFromTenant(
    badgeId: string,
    tenantId: string,
  ): Promise<void> {
    await this.badgeTenantRepository.softDelete({ badgeId, tenantId });
  }

  async removeBadgeFromAllTenants(badgeId: string): Promise<void> {
    await this.badgeTenantRepository.softDelete({ badgeId });
  }

  async addPublicBadgesToTenant(tenantId: string): Promise<boolean> {
    const tenant = await this.tenantsRepository.findOne({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    const publicBadges = await this.badgeRepository.find({
      where: {
        visibilityType: BadgeVisibilityType.PUBLIC,
        status: BadgeStatus.ACTIVE,
      },
    });
    if (publicBadges.length === 0) {
      throw new NotFoundException('No public badges found');
    }
    await this.badgeTenantRepository.save(
      publicBadges.map((badge) => ({
        badgeId: badge.id,
        tenantId: tenant.id,
      })),
    );

    return true;
  }
}
