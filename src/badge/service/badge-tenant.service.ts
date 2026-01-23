import { In, Repository } from 'typeorm';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BadgeTenant } from '../entity/badge-tenant.entity';
import { TenantsRepository } from 'src/tenant/repository/tenant.repository';
import { Badge } from '../entity/badge.entity';
import { BadgeStatus, BadgeVisibilityType } from '../constants/badge.constants';

@Injectable()
export class BadgeTenantService {
  private readonly logger = new Logger(BadgeTenantService.name);

  constructor(
    @InjectRepository(BadgeTenant)
    private readonly badgeTenantRepository: Repository<BadgeTenant>,
    private readonly tenantsRepository: TenantsRepository,
    @InjectRepository(Badge)
    private readonly badgeRepository: Repository<Badge>,
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

  async assignBadgeToTenants(
    badge: Badge,
    tenantIds?: string[],
  ): Promise<string[]> {
    try {
      let finalTenantIds: string[] = [];

      if (badge.visibilityType === BadgeVisibilityType.PUBLIC) {
        const tenants = await this.tenantsRepository.find();
        finalTenantIds = tenants.map((tenant) => tenant.id);
      } else if (tenantIds && tenantIds.length > 0) {
        finalTenantIds = tenantIds;
      }

      if (finalTenantIds.length > 0) {
        const badgeTenants = finalTenantIds.map((tenantId) =>
          this.badgeTenantRepository.create({
            badgeId: badge.id,
            tenantId,
          }),
        );
        await this.badgeTenantRepository.save(badgeTenants);
      }

      this.logger.log(`Badge ${badge.id} assigned to tenants`);
      return finalTenantIds;
    } catch (error) {
      this.logger.error(
        `Failed to assign badge ${badge.id} to tenants`,
        error.stack,
      );
      return [];
    }
  }

  async getTenantIdsForBadge(badgeId: string): Promise<string[]> {
    const badgeTenants = await this.badgeTenantRepository.find({
      where: { badgeId },
    });
    return badgeTenants.map((badgeTenant) => badgeTenant.tenantId);
  }

  async removeBadgeFromTenants(
    badgeId: string,
    tenantIds: string[],
  ): Promise<void> {
    if (tenantIds.length === 0) {
      return;
    }
    await this.badgeTenantRepository.softDelete({
      badgeId,
      tenantId: In(tenantIds),
    });
    this.logger.log(
      `Badge ${badgeId} removed from tenants: ${tenantIds.join(', ')}`,
    );
  }

  async updateBadgeTenants(
    badgeId: string,
    tenantIds: string[],
  ): Promise<string[]> {
    if (tenantIds.length === 0) {
      return [];
    }

    // Check which tenants already have this badge
    const existingMappings = await this.badgeTenantRepository.find({
      where: { badgeId, tenantId: In(tenantIds) },
    });

    const existingTenantIds = new Set(existingMappings.map((m) => m.tenantId));
    const newTenantIds = tenantIds.filter((id) => !existingTenantIds.has(id));

    if (newTenantIds.length > 0) {
      const badgeTenants = newTenantIds.map((tenantId) =>
        this.badgeTenantRepository.create({
          badgeId,
          tenantId,
        }),
      );
      await this.badgeTenantRepository.save(badgeTenants);
      this.logger.log(
        `Badge ${badgeId} added to new tenants: ${newTenantIds.join(', ')}`,
      );
    }

    return newTenantIds;
  }
}
