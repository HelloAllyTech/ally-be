import { Injectable } from '@nestjs/common';
import { UserGroup } from 'src/authorization/entity/user-group.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';

@Injectable()
export class UserGroupRepository extends Repository<UserGroup> {
  constructor(private dataSource: DataSource) {
    super(UserGroup, dataSource.createEntityManager());
  }

  async getUserGroupsByUserIds(
    userIds: number[],
    entityManager?: EntityManager,
  ) {
    const queryRunner = entityManager || this.dataSource;
    const roles = await queryRunner
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
