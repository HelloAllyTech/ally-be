import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Group } from 'src/authorization/entity/group.entity';
import { UserGroup } from 'src/authorization/entity/user-group.entity';

@Injectable()
export class GroupRepository extends Repository<Group> {
  constructor(private dataSource: DataSource) {
    super(Group, dataSource.createEntityManager());
  }

  async getAll(options?: any): Promise<Group[]> {
    return this.find(options || {});
  }

  async findUserRoleByUserId(userId: number): Promise<Group[]> {
    return this.createQueryBuilder('group')
      .leftJoin(UserGroup, 'ug', 'ug.groupId = group.id')
      .where('ug.userId = :userId', { userId })
      .getMany();
  }
}
