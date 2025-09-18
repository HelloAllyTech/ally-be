import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/service/redis.service';
import { GroupService } from 'src/authorization/service/group.service';

@Injectable()
export class PermissionsService {
  constructor(
    private readonly groupService: GroupService,
    private readonly cache: RedisService,
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
}
