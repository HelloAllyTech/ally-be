import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Group } from 'src/authorization/entity/group.entity';
import { UserGroup } from 'src/authorization/entity/user-group.entity';

@Injectable()
export class GroupRepository extends Repository<Group> {
  constructor(private dataSource: DataSource) {
    super(Group, dataSource.createEntityManager());
  }

  async getAll(options?: any, entityManager?: EntityManager): Promise<Group[]> {
    const repository = entityManager
      ? entityManager.getRepository(Group)
      : this;
    return repository.find(options || {});
  }

  async findUserRoleByUserId(
    userId: number,
    entityManager?: EntityManager,
  ): Promise<Group[]> {
    const repository = entityManager
      ? entityManager.getRepository(Group)
      : this;
    return repository
      .createQueryBuilder('group')
      .leftJoin(UserGroup, 'ug', 'ug.groupId = group.id')
      .where('ug.userId = :userId', { userId })
      .getMany();
  }
}
