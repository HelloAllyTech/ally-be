import { Group } from 'src/common/entities/group.entity';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from 'src/logger/logger.service';
import { AssignUserRoleDto, RemoveUserRoleDto } from 'src/user/dto/group.dto';
import { GroupRepository } from 'src/authorization/repository/group.repository';
import { UserGroupRepository } from '../repository/user-group.repository';

@Injectable()
export class GroupService {
  private readonly logger = LoggerService.getInstance(GroupService.name);
  constructor(
    private readonly cache: RedisService,
    private readonly groupRepository: GroupRepository,
    private readonly userGroupRepository: UserGroupRepository,
  ) {}

  async getUserGroups(userId: string): Promise<number[]> {
    const cachedUserGroups = await this.cache.get(`user:groups:${userId}`);
    if (cachedUserGroups) {
      return JSON.parse(cachedUserGroups);
    }
    const userGroups = await this.getUserRolesByUserId(userId);
    const groupIds = userGroups.map((group) => group.id);
    await this.cache.set(`user:groups:${userId}`, JSON.stringify(groupIds));
    return groupIds;
  }

  async assignRole(assignUserRoleDto: AssignUserRoleDto): Promise<boolean> {
    const { role, userId } = assignUserRoleDto;
    const group = await this.groupRepository.findOne({ name: role });
    if (!group) {
      this.logger.error(`Role not found: ${role} for user ${userId}`);
      throw new NotFoundException('Role not found');
    }
    // Check if user group already exists
    const existingUserGroup = await this.userGroupRepository.findOne({
      groupId: group.id,
      userId,
    });

    if (existingUserGroup) {
      this.logger.error(
        `User is already assigned to this role: ${role} for user ${userId}`,
      );
      throw new BadRequestException('User is already assigned to this role');
    }
    await this.userGroupRepository.create({
      groupId: group.id,
      userId,
    });
    await this.cache.del(`user:groups:${userId}`);
    await this.cache.del(`user:roles:${userId}`);
    return true;
  }

  async removeRole(removeUserRoleDto: RemoveUserRoleDto): Promise<boolean> {
    const { role, userId } = removeUserRoleDto;
    const group = await this.groupRepository.findOne({
      name: role,
    });
    if (!group) {
      this.logger.error(`Role not found: ${role}`);
      throw new NotFoundException('Role not found');
    }
    const userGroup = await this.userGroupRepository.findOne({
      groupId: group.id,
      userId,
    });
    if (!userGroup) {
      this.logger.error(`User role not found: ${role} for user ${userId}`);
      throw new NotFoundException('User role not found');
    }

    // Check if user has more than one group
    const userGroupsCount = await this.userGroupRepository.count({
      userId,
    });

    if (userGroupsCount <= 1) {
      this.logger.error(
        `User must have at least one role: ${role} for user ${userId}`,
      );
      throw new BadRequestException('User must have at least one role');
    }
    await this.userGroupRepository.remove(userGroup);
    await this.cache.del(`user:groups:${userId}`);
    await this.cache.del(`user:roles:${userId}`);
    return true;
  }

  async getUserRolesByUserId(userId: string): Promise<Group[]> {
    return this.groupRepository.findUserRoleByUserId(userId);
  }
}
