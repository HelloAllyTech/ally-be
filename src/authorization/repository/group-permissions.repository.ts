import { GroupPermission } from 'src/common/entities/group-permission.entity';
import { In, Repository } from 'typeorm';
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

  async findGroupPermission(groupId: number, permissionId: number) {
    return this.groupPermissionsRepository.findOne({
      where: {
        groupId,
        permissionId,
      },
    });
  }

  async createGroupPermission(groupIds: number[], permissionId: number) {
    const groupPermissions = groupIds.map((groupId) =>
      this.groupPermissionsRepository.create({
        groupId,
        permissionId,
      }),
    );

    return this.groupPermissionsRepository.save(groupPermissions);
  }

  async findByPermissionId(permissionId: number) {
    return this.groupPermissionsRepository.find({
      where: { permissionId },
      select: ['groupId', 'permissionId'],
    });
  }

  async deleteGroupPermissions(permissionId: number, groupIds?: number[]) {
    const where: any = { permissionId };

    if (groupIds?.length) {
      where.groupId = In(groupIds);
    }

    return this.groupPermissionsRepository.delete(where);
  }
}
