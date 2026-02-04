import { Group } from 'src/authorization/entity/group.entity';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from 'src/redis/service/redis.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  AssignUserRoleDto,
  ChangeUserRolesDto,
  RemoveUserRoleDto,
} from 'src/user/dto/group.dto';
import { In, DataSource } from 'typeorm';
import { GroupRepository } from 'src/authorization/repository/group.repository';
import { UserGroupRepository } from '../repository/user-group.repository';
import { UserRepository } from 'src/user/repository/user.repository';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthorizationEvents } from '../type/authorization-event.type';
import { ExecutionManager } from 'src/common/execution/execution-manager';

@Injectable()
export class GroupService {
  private readonly logger = LoggerService.getInstance(GroupService.name);
  constructor(
    private readonly cache: RedisService,
    private readonly groupRepository: GroupRepository,
    private readonly userGroupRepository: UserGroupRepository,
    private readonly userRepository: UserRepository,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getAllRoles(): Promise<Group[]> {
    return this.groupRepository.getAll();
  }

  async getGroupNames(groupIds: number[]): Promise<string[]> {
    const groupNames = await this.groupRepository.getAll({
      where: { id: In(groupIds) },
    });

    return groupNames.map((group) => group.name);
  }

  async getUserGroupIds(userId: number): Promise<number[]> {
    const cachedUserGroups = await this.cache.get(`user:groups:${userId}`);
    if (cachedUserGroups) {
      return JSON.parse(cachedUserGroups);
    }
    const userGroups = await this.getUserRolesByUserId(userId);
    const groupIds = userGroups.map((group) => group.id);
    await this.cache.set(`user:groups:${userId}`, JSON.stringify(groupIds));
    return groupIds;
  }

  async getUserGroupNames(userId: number): Promise<string[]> {
    const cachedUserGroups = await this.cache.get(`user:groups:${userId}`);
    if (cachedUserGroups) {
      const userGroups = JSON.parse(cachedUserGroups);
      return await this.getGroupNames(userGroups);
    }
    const userGroups = await this.getUserRolesByUserId(userId);
    const groupNames = userGroups.map((group) => group.name);
    return groupNames;
  }

  async assignRole(assignUserRoleDto: AssignUserRoleDto): Promise<boolean> {
    const tenantId = ExecutionManager.getTenantId();

    const { role, userId } = assignUserRoleDto;
    const group = await this.groupRepository.findOne({ where: { name: role } });
    if (!group) {
      this.logger.error(`Role not found: ${role} for user ${userId}`);
      throw new NotFoundException('Role not found');
    }
    // Check if user group already exists
    const existingUserGroup = await this.userGroupRepository.findOne({
      where: { groupId: group.id, userId },
    });

    if (existingUserGroup) {
      this.logger.error(
        `User is already assigned to this role: ${role} for user ${userId}`,
      );
      throw new BadRequestException('User is already assigned to this role');
    }
    const newUserGroup = this.userGroupRepository.create({
      groupId: group.id,
      userId,
    });
    await this.userGroupRepository.save(newUserGroup);
    await this.cache.del(`user:groups:${userId}`);
    await this.cache.del(`user:roles:${userId}`);

    this.eventEmitter.emit(AuthorizationEvents.USER_ROLE_ASSIGNED, {
      userId,
      groupId: group.id,
      tenantId,
    });

    return true;
  }

  async removeRole(removeUserRoleDto: RemoveUserRoleDto): Promise<boolean> {
    const { role, userId } = removeUserRoleDto;
    const group = await this.groupRepository.findOne({
      where: { name: role },
    });
    if (!group) {
      this.logger.error(`Role not found: ${role}`);
      throw new NotFoundException('Role not found');
    }
    const userGroup = await this.userGroupRepository.findOne({
      where: { groupId: group.id, userId },
    });

    if (!userGroup) {
      this.logger.error(`User role not found: ${role} for user ${userId}`);
      throw new NotFoundException('User role not found');
    }

    // Check if user has more than one group
    const userGroupsCount = await this.userGroupRepository.count({
      where: { userId },
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

  async getUserRolesByUserId(userId: number): Promise<Group[]> {
    return this.groupRepository.findUserRoleByUserId(userId);
  }

  async changeUserRoles(changeUserRolesDto: ChangeUserRolesDto) {
    const user = await this.userRepository.findOne({
      where: { id: changeUserRolesDto.userId },
    });

    if (!user) {
      throw new NotFoundException(
        `User with ID ${changeUserRolesDto.userId} not found`,
      );
    }
    const groups = await this.groupRepository.getAll({
      where: { id: In(changeUserRolesDto.groupIds) },
    });

    if (groups.length !== changeUserRolesDto.groupIds.length) {
      throw new NotFoundException(`One or more roles not found`);
    }
    try {
      // Get current user-group mappings
      const currentUserGroups = await this.userGroupRepository.find({
        where: { userId: changeUserRolesDto.userId },
      });
      const currentGroupIds = currentUserGroups.map((group) => group.groupId);

      const groupIdsToAdd = changeUserRolesDto.groupIds.filter(
        (id) => !currentGroupIds.includes(id),
      );
      const groupIdsToRemove = currentGroupIds.filter(
        (id) => !changeUserRolesDto.groupIds.includes(id),
      );

      await this.dataSource.transaction(async () => {
        if (groupIdsToRemove.length > 0) {
          const userGroupsToRemove = currentUserGroups.filter((group) =>
            groupIdsToRemove.includes(group.groupId),
          );
          for (const userGroup of userGroupsToRemove) {
            await this.userGroupRepository.remove(userGroup);
          }
        }
        if (groupIdsToAdd.length > 0) {
          for (const groupId of groupIdsToAdd) {
            const newUserGroup = this.userGroupRepository.create({
              userId: changeUserRolesDto.userId,
              groupId,
            });
            await this.userGroupRepository.save(newUserGroup);
          }
        }
      });

      this.cache.del(`user:groups:${changeUserRolesDto.userId}`);
      this.cache.del(`user:roles:${changeUserRolesDto.userId}`);
      return {
        success: true,
        message: `User roles updated successfully`,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to update user roles: ${error.message}`,
      );
    }
  }
}
