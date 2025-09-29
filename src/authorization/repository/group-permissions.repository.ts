import { GroupPermission } from 'src/common/entities/group-permission.entity';
import { Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Permission } from 'src/common/entities/permission.entity';

@Injectable()
export class GroupPermissionsRepository {
  constructor(
    @InjectRepository(GroupPermission)
    private readonly groupPermissionsRepository: Repository<GroupPermission>,
  ) {}

  async findPermissionsByGroupId(
    groupIds: number[],
  ): Promise<{ groupId: number; permission: string }[]> {
    return this.groupPermissionsRepository
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
