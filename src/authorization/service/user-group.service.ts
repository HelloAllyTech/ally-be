import { Injectable } from '@nestjs/common';
import { UserGroupRepository } from '../repository/user-group.repository';
import { UserGroup } from 'src/common/entities/user-group.entity';

@Injectable()
export class UserGroupService {
  constructor(private readonly userGroupRepository: UserGroupRepository) {}

  async getUserGroups(userId: number): Promise<UserGroup[]> {
    return this.userGroupRepository.findMany({ userId });
  }

  async getUserGroupsByUserIds(userIds: number[]) {
    return this.userGroupRepository.getUserGroupsByUserIds(userIds);
  }
}
