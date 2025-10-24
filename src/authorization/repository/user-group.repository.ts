import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserGroup } from 'src/common/entities/user-group.entity';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';

@Injectable()
export class UserGroupRepository {
  constructor(
    @InjectRepository(UserGroup)
    private readonly userGroupRepository: Repository<UserGroup>,
    private readonly dataSource: DataSource,
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

  async findMany(where: FindOptionsWhere<UserGroup>): Promise<UserGroup[]> {
    return this.userGroupRepository.find({ where });
  }

  async getUserGroupsByUserIds(userIds: number[]) {
    const roles = await this.dataSource
      .createQueryBuilder(UserGroup, 'ug')
      .innerJoin('groups', 'g', 'g.id = ug."groupId"')
      .where('ug."userId" IN (:...userIds)', { userIds })
      .select('ug."userId"', 'userId')
      .addSelect('ARRAY_AGG(DISTINCT g.name)', 'roles')
      .groupBy('ug."userId"')
      .getRawMany();
    return roles;
  }
}
