import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminTenantRepository } from '../repository/admin-tenant.repository';
import { UserRepository } from '../repository/user.repository';
import { TenantService } from '../../tenant/service/tenant.service';
import { GroupService } from '../../authorization/service/group.service';
import {
  AssignAdminTenantsDto,
  RemoveAdminTenantsDto,
} from '../dto/admin-tenant.dto';
import { UserRole } from 'src/common/constants/user.constants';
import { AdminTenant } from '../entity/admin-tenant.entity';
import { LoggerService } from 'src/logger/logger.service';
import { SuccessResponse } from 'src/common/type/common.type';

@Injectable()
export class AdminTenantService {
  private readonly logger = LoggerService.getInstance(AdminTenantService.name);

  constructor(
    private readonly adminTenantRepository: AdminTenantRepository,
    private readonly userRepository: UserRepository,
    @Inject(forwardRef(() => TenantService))
    private readonly tenantService: TenantService,
    private readonly groupService: GroupService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Assigns one or more tenants to a PLATFORM_ADMIN user, restricting them to
   * that set (see `hasAnyTenantMappings` — presence of any row at all is what
   * makes a platform admin tenant-restricted; this is orthogonal to which
   * feature toggles they hold). Requires the admin_user_management toggle
   * (enforced at the controller).
   *
   * Strategy:
   *   - If a mapping was previously soft-deleted → restore it (set deletedAt = null).
   *   - If a mapping is already active → skip it (idempotent).
   *   - If no mapping exists at all → create a new one.
   */
  async assignTenants(dto: AssignAdminTenantsDto): Promise<SuccessResponse> {
    const { userId, tenantIds } = dto;

    // Validate user exists
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Validate user is a platform admin — a tenant allowlist only makes sense
    // as a restriction on someone who otherwise has platform-wide reach.
    const roles = await this.groupService.getUserRolesByUserId(userId);
    const isPlatformAdmin = roles.some(
      (r) => r.name === UserRole.PLATFORM_ADMIN,
    );
    if (!isPlatformAdmin) {
      throw new BadRequestException(
        `User ${userId} does not have the ${UserRole.PLATFORM_ADMIN} role`,
      );
    }

    // Validate all tenants exist
    for (const tenantId of tenantIds) {
      const tenant = await this.tenantService.findById(tenantId);
      if (!tenant) {
        throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
      }
    }

    // Fetch ALL existing mappings (active + soft-deleted) to avoid duplicate inserts
    const existingAll =
      await this.adminTenantRepository.findByUserIdAndTenantIdsIncludingDeleted(
        userId,
        tenantIds,
      );

    const existingMap = new Map(existingAll.map((e) => [e.tenantId, e]));

    const toRestore: AdminTenant[] = [];
    const toCreate: AdminTenant[] = [];

    for (const tenantId of tenantIds) {
      const existing = existingMap.get(tenantId);
      if (!existing) {
        // Brand new mapping
        toCreate.push(this.adminTenantRepository.create({ userId, tenantId }));
      } else if (existing.deletedAt) {
        // Previously removed — restore by clearing deletedAt
        existing.deletedAt = undefined;
        toRestore.push(existing);
      }
      // else: already active → skip (idempotent)
    }

    if (toRestore.length > 0) {
      // recover() clears the soft-delete timestamp and saves
      await this.adminTenantRepository.recover(toRestore);
      this.logger.info(
        `Restored ${toRestore.length} previously-removed tenant mapping(s) for admin user ${userId}`,
      );
    }

    if (toCreate.length > 0) {
      await this.adminTenantRepository.save(toCreate);
      this.logger.info(
        `Assigned ${toCreate.length} new tenant(s) to admin user ${userId}`,
      );
    }

    return { success: true };
  }

  /**
   * Removes one or more tenant mappings from a MULTI_TENANT_ADMIN user.
   * Super admin only.
   */
  async removeTenants(dto: RemoveAdminTenantsDto): Promise<SuccessResponse> {
    const { userId, tenantIds } = dto;

    const mappings = await this.adminTenantRepository.findByUserIdAndTenantIds(
      userId,
      tenantIds,
    );

    if (mappings.length === 0) {
      throw new NotFoundException(
        `No active tenant mappings found for user ${userId} with the given tenant IDs`,
      );
    }

    await this.adminTenantRepository.softRemove(mappings);
    this.logger.info(
      `Removed ${mappings.length} tenant mapping(s) from admin user ${userId}`,
    );

    return { success: true };
  }

  /**
   * Presence-of-rows check replacing the old role-name-keyed
   * `isMultiTenantAdmin` gate: ANY platform admin with at least one active
   * tenant mapping is treated as tenant-restricted, regardless of which
   * feature toggles they hold. Absence of rows means unrestricted (sees every
   * tenant) — the same behaviour a plain SUPER_ADMIN/SUPER_DUPER_ADMIN has
   * today, generalized to "any platform admin can optionally be
   * tenant-restricted."
   */
  async hasAnyTenantMappings(userId: number): Promise<boolean> {
    const mappings = await this.adminTenantRepository.findByUserId(userId);
    return mappings.length > 0;
  }

  /**
   * Returns all tenants currently mapped to a tenant-restricted platform admin.
   */
  async getTenantsForAdmin(userId: number) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const mappings = await this.adminTenantRepository.findByUserId(userId);
    const tenantIds = mappings.map((m) => m.tenantId);

    if (tenantIds.length === 0) {
      return { data: [], count: 0 };
    }

    const tenants = await Promise.all(
      tenantIds.map((id) => this.tenantService.findById(id)),
    );

    const validTenants = tenants.filter(Boolean);
    return { data: validTenants, count: validTenants.length };
  }
}
