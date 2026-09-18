import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  AUTHZ_MESSAGES,
  FAILURE_MESSAGES,
} from 'src/exception/failure-messages';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { RedisService } from 'src/redis/service/redis.service';
import { GroupService } from 'src/authorization/service/group.service';
import { GroupPermissionsService } from './group-permissions.service';
import { UserGroupService } from './user-group.service';
import { ValidatePermissionsDto } from '../dto/validate-permissions.dto';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SuccessResponse } from 'src/common/type/common.type';
import { PermissionOperator } from '../type/authorization-event.type';
import { LoggerService } from 'src/logger/logger.service';
import { AdminTenant } from 'src/user/entity/admin-tenant.entity';

@Injectable()
export class PermissionsService {
  private readonly logger = LoggerService.getInstance(PermissionsService.name);
  constructor(
    private readonly groupService: GroupService,
    private readonly cache: RedisService,
    private readonly groupPermissionsService: GroupPermissionsService,
    private readonly userGroupService: UserGroupService,
    // Repository, not AdminTenantService: importing anything from
    // src/user/service/* here (even a plain type import, even resolved lazily
    // via ModuleRef) participates in an existing circular require chain
    // between AuthorizationModule and UserModule and breaks Nest's decorator
    // metadata resolution at boot (confirmed empirically — not caught by
    // isolated unit-test TestingModules, only by an actual app bootstrap).
    // A plain entity has no service dependencies of its own, so it carries no
    // such risk; AdminTenant is registered in AuthorizationModule's own
    // TypeOrmModule.forFeature for this purpose.
    @InjectRepository(AdminTenant)
    private readonly adminTenantRepository: Repository<AdminTenant>,
  ) {}

  async getUserRoles(userId: number): Promise<string[]> {
    const cachedUserRoles = await this.cache.get(`user:roles:${userId}`);

    if (cachedUserRoles) {
      return JSON.parse(cachedUserRoles);
    }
    const userRoles = await this.groupService.getUserRolesByUserId(userId);
    const roleNames = userRoles.map((role) => role.name);
    // TTL (30 min) matches `user:groups` / `group:permissions` so an
    // out-of-band role change (e.g. a promotion applied by a raw SQL migration,
    // which cannot bust Redis) self-heals instead of being cached forever.
    await this.cache.set(
      `user:roles:${userId}`,
      JSON.stringify(roleNames),
      1800,
    );
    return roleNames;
  }

  /**
   * Historically a role-name check ("does this user hold MULTI_TENANT_ADMIN").
   * Post role-collapse (PLATFORM_ADMIN replaces SUPER_ADMIN/SUPER_DUPER_ADMIN/
   * MULTI_TENANT_ADMIN — see CreatePlatformAdminRole1895000000001), there is no
   * role name left to check, so this is now a presence-of-rows check: any
   * platform admin with at least one `admin_tenants` mapping is treated as
   * tenant-restricted, and every one of this method's ~14 call sites (ownership
   * scoping in scenario/session-event/badge/roleplay services, plus the
   * tenant-allowlist filter in UserService.getAllUsers) gets that behaviour for
   * free without needing its own change. This exactly preserves current
   * effective access for already-migrated accounts: today only
   * MULTI_TENANT_ADMIN holders have `admin_tenants` rows, so nothing changes
   * for them, and the same ownership-scoping/tenant-allowlist restriction now
   * generalizes to any future platform admin who is deliberately tenant-
   * restricted (see AdminTenantService.assignTenants).
   */
  async isMultiTenantAdmin(userId: number): Promise<boolean> {
    const count = await this.adminTenantRepository.count({
      where: { userId, deletedAt: IsNull() },
    });
    return count > 0;
  }

  async validatePermissions(
    validatePermissionsDto: ValidatePermissionsDto,
  ): Promise<SuccessResponse> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new UnauthorizedException({
        message: FAILURE_MESSAGES.UNAUTHENTICATED,
        error: 'Unauthorized',
        statusCode: HttpStatus.UNAUTHORIZED,
        errorCode: ErrorCode.UNAUTHENTICATED,
      });
    }

    const userPermissions = await this.getUserPermissions(Number(userId));
    const operator = validatePermissionsDto.operator ?? PermissionOperator.AND;

    const hasPermission =
      operator === PermissionOperator.AND
        ? validatePermissionsDto.permissions.every((permission) =>
            userPermissions.includes(permission),
          )
        : validatePermissionsDto.permissions.some((permission) =>
            userPermissions.includes(permission),
          );

    if (!hasPermission) {
      // The required permissions were right here and were being thrown away in
      // favour of a generic 'Insufficient permissions'. This endpoint exists so
      // a client can ASK whether it may show a surface — an answer that does not
      // say what was missing forces the caller to guess, which is exactly what
      // it called this endpoint to avoid.
      const missing = validatePermissionsDto.permissions.filter(
        (permission) => !userPermissions.includes(permission),
      );
      this.logger.warn(
        `User ${userId} does not have the required permissions: required ` +
          `[${validatePermissionsDto.permissions.join(', ')}] (${operator}), ` +
          `missing [${missing.join(', ')}]`,
      );
      throw new ForbiddenException({
        message: AUTHZ_MESSAGES.missingPermissions(
          validatePermissionsDto.permissions,
          operator === PermissionOperator.AND ? 'AND' : 'OR',
        ),
        error: 'Forbidden',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: ErrorCode.PERMISSION_DENIED,
        requiredPermissions: validatePermissionsDto.permissions,
        permissionOperator: operator,
      });
    }

    return { success: true };
  }

  async getUserPermissions(id: number): Promise<string[]> {
    const cachedUserGroups = await this.cache.get(`user:groups:${id}`);
    let userGroups;

    if (cachedUserGroups) {
      userGroups = JSON.parse(cachedUserGroups);
    } else {
      const groups = await this.userGroupService.getUserGroups(id);
      userGroups = groups.map((group) => group.groupId);

      await this.cache.set(
        `user:groups:${id}`,
        JSON.stringify(userGroups),
        1800, // 30 minutes
      );
    }

    if (!userGroups.length) return [];

    const permissions = new Set<string>();
    const missingGroupIds = new Set<number>();

    for (const groupId of userGroups) {
      const cachedGroupPermissions = await this.cache.get(
        `group:permissions:${groupId}`,
      );
      if (cachedGroupPermissions) {
        const groupPermissions = JSON.parse(cachedGroupPermissions);
        groupPermissions.forEach((p: string) => permissions.add(p));
      } else {
        missingGroupIds.add(groupId);
      }
    }

    // If any permissions are missing from cache, fetch them all at once
    if (missingGroupIds.size > 0) {
      const missingPermissions =
        await this.groupPermissionsService.getGroupPermissions([
          ...missingGroupIds,
        ]);

      // Group permissions by groupId
      const groupedPermissions = missingPermissions.reduce(
        (acc, curr) => {
          if (!acc[curr.groupId]) {
            acc[curr.groupId] = [];
          }
          acc[curr.groupId].push(curr.permission);
          permissions.add(curr.permission);
          return acc;
        },
        {} as Record<number, string[]>,
      );

      // Cache each group's permissions
      await Promise.all(
        Object.entries(groupedPermissions).map(([groupId, perms]) =>
          this.cache.set(
            `group:permissions:${groupId}`,
            JSON.stringify(perms),
            1800,
          ),
        ),
      );
    }

    return [...permissions];
  }
}
