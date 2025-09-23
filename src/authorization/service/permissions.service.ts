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

  async getUserPermissions(userId: number): Promise<string[]> {
    const cachedUserPermissions = await this.cache.get(
      `user:permissions:${userId}`,
    );
    if (cachedUserPermissions) {
      return JSON.parse(cachedUserPermissions);
    }
    const groups = await this.userGroupService.getUserGroups(userId);
    const groupIds = groups.map((group) => group.groupId);
    const permissions =
      await this.groupPermissionsService.getGroupPermissions(groupIds);
    await this.cache.set(
      `user:permissions:${userId}`,
      JSON.stringify(permissions),
      1800, // 30 minutes
    );
    return permissions;
  }
}
