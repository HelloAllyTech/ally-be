import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/service/redis.service';
import { GroupService } from 'src/authorization/service/group.service';
import { GroupPermissionsService } from './group-permissions.service';
import { UserGroupService } from './user-group.service';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly groupService: GroupService,
    private readonly cache: RedisService,
    private readonly groupPermissionsService: GroupPermissionsService,
    private readonly userGroupService: UserGroupService,
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
    // Get user's groups from cache or DB
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

    // Get permissions for each group from cache or DB
    const permissions = new Set<string>();
    const missingGroupIds = new Set<number>();

    // First check cache for all groups
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
