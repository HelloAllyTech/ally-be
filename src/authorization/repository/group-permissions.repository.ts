import { GroupPermission } from 'src/authorization/entity/group-permission.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { Permission } from 'src/authorization/entity/permission.entity';

@Injectable()
export class GroupPermissionsRepository extends Repository<GroupPermission> {
  constructor(private dataSource: DataSource) {
    super(GroupPermission, dataSource.createEntityManager());
  }

  async findPermissionsByGroupId(
    groupIds: number[],
    entityManager?: EntityManager,
  ): Promise<{ groupId: number; permission: string }[]> {
    const repository = entityManager
      ? entityManager.getRepository(GroupPermission)
      : this;

    return repository
      .createQueryBuilder('group_permissions')
      .leftJoin(
        Permission,
        'permission',
        'permission.id = group_permissions.permissionId',
      )
      .select('group_permissions.groupId', 'groupId')
      .addSelect('permission.name', 'permission')
      .where('group_permissions.groupId IN (:...groupIds)', { groupIds })
      .getRawMany();
  }
}
