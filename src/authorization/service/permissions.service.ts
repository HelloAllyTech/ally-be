import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from 'src/redis/service/redis.service';
import { GroupService } from 'src/authorization/service/group.service';
import { GroupPermissionsService } from './group-permissions.service';
import { UserGroupService } from './user-group.service';
import { PermissionRepository } from '../repository/permission.repository';
import { Permission } from 'src/common/entities/permission.entity';
import {
  CreatePermissionDto,
  DeleteGroupsPermissionDto,
  DeletePermissionDto,
  GrantPermissionToRolesDto,
} from '../dto/permissions.dto';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly groupService: GroupService,
    private readonly cache: RedisService,
    private readonly groupPermissionsService: GroupPermissionsService,
    private readonly userGroupService: UserGroupService,
    private readonly permissionRepository: PermissionRepository,
  ) {}

  async getUserRoles(userId: number): Promise<string[]> {
    const cachedUserRoles = await this.cache.get(`user:roles:${userId}`);

    if (cachedUserRoles) {
      return JSON.parse(cachedUserRoles);
    }
    const userRoles = await this.groupService.getUserRolesByUserId(userId);
    const roleNames = userRoles.map((role) => role.name);
    await this.cache.set(`user:roles:${userId}`, JSON.stringify(roleNames));
    return roleNames;
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

  async createPermission(
    createPermissionDto: CreatePermissionDto,
  ): Promise<Permission> {
    const existingPermission =
      await this.permissionRepository.getPermissionByName(
        createPermissionDto.permissionName,
      );
    if (existingPermission) {
      throw new ConflictException(
        `Permission "${createPermissionDto.permissionName}" already exists`,
      );
    }
    return this.permissionRepository.createPermission(
      createPermissionDto.permissionName,
    );
  }

  async grantPermissionToRoles(
    grantPermissionToRolesDto: GrantPermissionToRolesDto,
  ) {
    const existingPermission =
      await this.permissionRepository.getPermissionByName(
        grantPermissionToRolesDto.permissionName,
      );
    if (!existingPermission) {
      throw new NotFoundException(
        `Permission "${grantPermissionToRolesDto.permissionName}" doesn't exists`,
      );
    }
    const permissionId = existingPermission?.id;

    const targetGroups = await this.groupService.getGroupsByNames(
      grantPermissionToRolesDto.roles,
    );

    // IDs of groups that should receive this permission
    const targetGroupIds = targetGroups.map((gp) => gp.id);
    const currentGroupPermissions =
      await this.groupPermissionsService.findByPermissionId(
        existingPermission.id,
      );

    // IDs of groups that already have this permission assigned
    const assignedGroupIds = currentGroupPermissions.map((gp) => gp.groupId);

    const unassignedGroupIds = targetGroupIds.filter(
      (id) => !assignedGroupIds.includes(id),
    );
    if (unassignedGroupIds.length > 0) {
      await this.groupPermissionsService.createGroupPermission(
        unassignedGroupIds,
        permissionId,
      );
      await Promise.all(
        unassignedGroupIds.map((groupId) =>
          this.cache.del(`group:permissions:${groupId}`),
        ),
      );
    } else {
      return {
        message: `Permission "${grantPermissionToRolesDto.permissionName}" already granted to passed roles`,
      };
    }
    return {
      message: `Permission "${grantPermissionToRolesDto.permissionName}" granted to roles`,
    };
  }

  async deleteGroupsPermission(
    deleteGroupsPermissionDto: DeleteGroupsPermissionDto,
  ) {
    const existingPermission =
      await this.permissionRepository.getPermissionByName(
        deleteGroupsPermissionDto.permissionName,
      );
    if (!existingPermission) {
      throw new NotFoundException(
        `Permission "${deleteGroupsPermissionDto.permissionName}" doesn't exists`,
      );
    }
    const permissionId = existingPermission.id;
    const groups = await this.groupService.getGroupsByNames(
      deleteGroupsPermissionDto.roles,
    );

    //List of group IDs (roles) to be deleted for corresponding to a permission
    const groupIds = groups.map((gp) => gp.id);
    await this.groupPermissionsService.deleteGroupsPermission(
      permissionId,
      groupIds,
    );
    await Promise.all(
      groupIds.map((groupId) => this.cache.del(`group:permissions:${groupId}`)),
    );
    return {
      Message: `Permission "${deleteGroupsPermissionDto.permissionName}"deleted successfully for given roles`,
    };
  }

  async deletePermission(deletePermissionDto: DeletePermissionDto) {
    const existingPermission =
      await this.permissionRepository.getPermissionByName(
        deletePermissionDto.permissionName,
      );
    if (!existingPermission) {
      throw new NotFoundException(
        `Permission "${deletePermissionDto.permissionName}" doesn't exists`,
      );
    }
    const permissionId = existingPermission.id;
    const groupPermissions =
      await this.groupPermissionsService.findByPermissionId(permissionId);
    const groupIds = groupPermissions.map((gp) => gp.groupId);

    if (groupIds.length > 0) {
      await this.groupPermissionsService.deleteGroupsPermission(permissionId);
      await Promise.all(
        groupIds.map((groupId) =>
          this.cache.del(`group:permissions:${groupId}`),
        ),
      );
    }

    await this.permissionRepository.deletePermissionById(permissionId);
    return {
      Message: `Permission "${deletePermissionDto.permissionName}"deleted successfully`,
    };
  }
}
