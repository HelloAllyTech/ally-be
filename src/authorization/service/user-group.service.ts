import { Injectable } from '@nestjs/common';
import { UserGroupRepository } from '../repository/user-group.repository';
import { UserGroup } from 'src/authorization/entity/user-group.entity';

@Injectable()
export class UserGroupService {
  constructor(private readonly userGroupRepository: UserGroupRepository) {}

  async getUserGroups(userId: number): Promise<UserGroup[]> {
    return this.userGroupRepository.find({ where: { userId } });
  }

  async getUserGroupsByUserIds(userIds: number[]) {
    return this.userGroupRepository.getUserGroupsByUserIds(userIds);
  }
}
