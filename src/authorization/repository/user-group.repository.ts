import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserGroup } from 'src/common/entities/user-group.entity';
import { FindOptionsWhere, Repository } from 'typeorm';

@Injectable()
export class UserGroupRepository {
  constructor(
    @InjectRepository(UserGroup)
    private readonly userGroupRepository: Repository<UserGroup>,
  ) {}

  async findOne(where: FindOptionsWhere<UserGroup>): Promise<UserGroup | null> {
    return this.userGroupRepository.findOne({ where });
  }

  async create({
    userId,
    groupId,
  }: {
    userId: number;
    groupId: number;
  }): Promise<UserGroup> {
    const newUserGroup = this.userGroupRepository.create({ userId, groupId });
    return this.userGroupRepository.save(newUserGroup);
  }

  async count(where: FindOptionsWhere<UserGroup>): Promise<number> {
    return this.userGroupRepository.count({ where });
  }
  async remove(userGroup: UserGroup): Promise<void> {
    await this.userGroupRepository.remove(userGroup);
  }
}
